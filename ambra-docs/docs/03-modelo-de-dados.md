# 03 — Modelo de Dados

**Última atualização:** 12-05-2026
**Status:** Ativo

---

## Domínios e Tabelas

### Tenant / Escola

```sql
schools
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  name          VARCHAR(255) NOT NULL
  cnpj          VARCHAR(18) UNIQUE
  slug          VARCHAR(100) UNIQUE NOT NULL   -- usado em URLs
  plan          VARCHAR(50) NOT NULL DEFAULT 'starter'
  status        VARCHAR(50) NOT NULL DEFAULT 'active'
  settings      JSONB NOT NULL DEFAULT '{}'    -- configs gerais da escola
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()

canteens
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  school_id     UUID NOT NULL REFERENCES schools(id)
  name          VARCHAR(255) NOT NULL
  status        VARCHAR(50) NOT NULL DEFAULT 'active'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

### Usuários

```sql
users
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
  school_id       UUID NOT NULL REFERENCES schools(id)
  email           VARCHAR(255) NOT NULL
  password_hash   VARCHAR(255) NOT NULL
  role            VARCHAR(50) NOT NULL   -- SCHOOL_ADMIN | CANTEEN_OP | GUARDIAN | STUDENT
  status          VARCHAR(50) NOT NULL DEFAULT 'active'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  UNIQUE (email, school_id)              -- mesmo email pode existir em escolas diferentes

profiles
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  user_id       UUID NOT NULL UNIQUE REFERENCES users(id)
  name          VARCHAR(255) NOT NULL
  document      VARCHAR(20)              -- CPF
  phone         VARCHAR(20)
  avatar_url    VARCHAR(500)

students
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
  school_id           UUID NOT NULL REFERENCES schools(id)
  profile_id          UUID NOT NULL UNIQUE REFERENCES profiles(id)
  registration_code   VARCHAR(50)        -- matrícula
  grade               VARCHAR(20)        -- série
  class               VARCHAR(20)        -- turma
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()

guardians
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid()
  user_id               UUID NOT NULL REFERENCES users(id)
  student_id            UUID NOT NULL REFERENCES students(id)
  relationship          VARCHAR(50)      -- pai, mãe, avó, responsável...
  spending_limit_daily  DECIMAL(10,2)    -- NULL = sem limite
  blocked_categories    UUID[]           -- array de category_id bloqueados
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  UNIQUE (user_id, student_id)

user_consents
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid()
  school_id            UUID NOT NULL REFERENCES schools(id)
  subject_user_id      UUID NOT NULL REFERENCES users(id)   -- titular do dado
  consented_by_user_id UUID NOT NULL REFERENCES users(id)   -- quem aceitou
  consent_type         VARCHAR(50) NOT NULL                -- TERMS_OF_USE | PRIVACY_POLICY | GUARDIAN_AUTHORIZATION
  version              VARCHAR(50) NOT NULL
  accepted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  revoked_at           TIMESTAMPTZ
  ip                   INET
  user_agent           TEXT
  metadata             JSONB NOT NULL DEFAULT '{}'

  UNIQUE (school_id, subject_user_id, consent_type, version)
```

### Catálogo

```sql
categories
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
  school_id   UUID NOT NULL REFERENCES schools(id)
  name        VARCHAR(100) NOT NULL
  slug        VARCHAR(100) NOT NULL
  is_active   BOOLEAN NOT NULL DEFAULT true
  sort_order  INTEGER NOT NULL DEFAULT 0
  UNIQUE (school_id, slug)

products
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  school_id     UUID NOT NULL REFERENCES schools(id)
  category_id   UUID NOT NULL REFERENCES categories(id)
  name          VARCHAR(255) NOT NULL
  description   TEXT
  price         DECIMAL(10,2) NOT NULL
  image_url     VARCHAR(500)
  is_active     BOOLEAN NOT NULL DEFAULT true
  allergens     JSONB NOT NULL DEFAULT '[]'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  
  CONSTRAINT product_price_positive CHECK (price >= 0)
```

### Estoque

```sql
inventory_items
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  school_id     UUID NOT NULL REFERENCES schools(id)
  product_id    UUID NOT NULL UNIQUE REFERENCES products(id)
  quantity      INTEGER NOT NULL DEFAULT 0
  min_quantity  INTEGER NOT NULL DEFAULT 5   -- alerta abaixo desse valor
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  
  CONSTRAINT inventory_non_negative CHECK (quantity >= 0)

inventory_moves
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  school_id     UUID NOT NULL REFERENCES schools(id)
  product_id    UUID NOT NULL REFERENCES products(id)
  type          VARCHAR(20) NOT NULL   -- IN | OUT | ADJUST | RESERVE | RELEASE
  quantity      INTEGER NOT NULL
  order_id      UUID REFERENCES orders(id)
  reason        TEXT
  created_by    UUID NOT NULL REFERENCES users(id)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  
  CONSTRAINT move_quantity_positive CHECK (quantity > 0)
```

**Regra:** `inventory_items.quantity` nunca é escrito diretamente pela aplicação.
Toda alteração passa por um `inventory_move`, que atualiza `quantity` via trigger.

### Carteira (Ledger)

```sql
wallets
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
  school_id   UUID NOT NULL REFERENCES schools(id)
  user_id     UUID NOT NULL UNIQUE REFERENCES users(id)
  balance     DECIMAL(10,2) NOT NULL DEFAULT 0.00
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  
  CONSTRAINT wallet_balance_non_negative CHECK (balance >= 0)

wallet_transactions
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid()
  school_id         UUID NOT NULL REFERENCES schools(id)
  wallet_id         UUID NOT NULL REFERENCES wallets(id)
  type              VARCHAR(10) NOT NULL   -- CREDIT | DEBIT
  amount            DECIMAL(10,2) NOT NULL
  balance_after     DECIMAL(10,2) NOT NULL  -- snapshot do saldo após a transação
  source            VARCHAR(20) NOT NULL    -- ORDER | RECHARGE | REFUND | ADJUSTMENT
  reference_id      UUID                   -- order_id ou payment_request_id
  description       TEXT NOT NULL
  idempotency_key   VARCHAR(255) UNIQUE     -- previne duplicatas
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  
  CONSTRAINT transaction_amount_positive CHECK (amount > 0)
```

**Regra:** `wallet_transactions` é append-only. Nunca UPDATE nem DELETE.
O saldo é recalculado por trigger a cada INSERT.
Ver ADR: [`adr/004-ledger-carteira.md`](adr/004-ledger-carteira.md)

### Pedidos

```sql
orders
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  school_id     UUID NOT NULL REFERENCES schools(id)
  student_id    UUID NOT NULL REFERENCES students(id)
  created_by    UUID NOT NULL REFERENCES users(id)     -- quem abriu o pedido no PDV
  confirmed_by  UUID REFERENCES users(id)              -- quem finalizou a confirmação
  status        VARCHAR(20) NOT NULL DEFAULT 'PENDING'
  total_amount  DECIMAL(10,2) NOT NULL
  notes         TEXT
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  
  CONSTRAINT order_total_positive CHECK (total_amount > 0)
  -- status: PENDING (rascunho) → CONFIRMED → DELIVERED | CANCELLED

order_items
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  order_id      UUID NOT NULL REFERENCES orders(id)
  product_id    UUID NOT NULL REFERENCES products(id)
  quantity      INTEGER NOT NULL
  unit_price    DECIMAL(10,2) NOT NULL   -- preço no momento do pedido (snapshot)
  subtotal      DECIMAL(10,2) NOT NULL
  
  CONSTRAINT item_quantity_positive CHECK (quantity > 0)
  CONSTRAINT item_price_positive CHECK (unit_price >= 0)

order_status_history
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  order_id      UUID NOT NULL REFERENCES orders(id)
  from_status   VARCHAR(20)
  to_status     VARCHAR(20) NOT NULL
  changed_by    UUID NOT NULL REFERENCES users(id)
  reason        TEXT
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

### Pagamentos

```sql
payment_requests
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid()
  school_id         UUID NOT NULL REFERENCES schools(id)
  wallet_id         UUID NOT NULL REFERENCES wallets(id)
  amount            DECIMAL(10,2) NOT NULL
  provider          VARCHAR(20) NOT NULL DEFAULT 'ASAAS'
  external_id       VARCHAR(255) UNIQUE    -- ID da cobrança no Asaas (charge_id)
  status            VARCHAR(20) NOT NULL DEFAULT 'PENDING'
  pix_code          TEXT                   -- código copia-e-cola
  pix_qr_url        VARCHAR(500)           -- URL da imagem do QR
  expires_at        TIMESTAMPTZ
  paid_at           TIMESTAMPTZ
  idempotency_key   VARCHAR(255) UNIQUE
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()

payment_webhooks
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid()
  provider          VARCHAR(20) NOT NULL
  external_id       VARCHAR(255)           -- ID do evento/entrega do webhook no provedor
  event_type        VARCHAR(100)           -- nome do evento normalizado
  payload           JSONB NOT NULL
  processed_at      TIMESTAMPTZ
  processing_result VARCHAR(50)   -- SUCCESS | ERROR | IGNORED
  error_message     TEXT
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**Regra:** Todo webhook recebido é gravado em `payment_webhooks` ANTES de qualquer
processamento. Se o processamento falhar, o registro existe para retry.
O tenant do evento vem de `payment_requests.school_id` depois da cobrança ser localizada.
`processing_result = SUCCESS` ou `IGNORED` é terminal; `ERROR` continua retriable sem criar um novo receipt.

### Auditoria

```sql
audit_logs
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  school_id     UUID REFERENCES schools(id)   -- NULL para eventos do sistema
  user_id       UUID REFERENCES users(id)
  action        VARCHAR(100) NOT NULL
  entity_type   VARCHAR(100)
  entity_id     UUID
  old_value     JSONB
  new_value     JSONB
  ip            INET
  user_agent    TEXT
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**Regra:** `audit_logs` é append-only. Nunca UPDATE nem DELETE.

---

## Invariantes de Dados

Estas regras são garantidas pelo banco, não apenas pela aplicação:

```sql
-- 1. Saldo nunca negativo
CONSTRAINT wallet_balance_non_negative CHECK (balance >= 0)

-- 2. Estoque nunca negativo
CONSTRAINT inventory_non_negative CHECK (quantity >= 0)

-- 3. Preço de produto nunca negativo
CONSTRAINT product_price_positive CHECK (price >= 0)

-- 4. Valor de transação sempre positivo (type indica direção)
CONSTRAINT transaction_amount_positive CHECK (amount > 0)

-- 5. Total de pedido sempre positivo
CONSTRAINT order_total_positive CHECK (total_amount > 0)
```

---

## Fluxo Financeiro — Regras de Ouro

### Regra 1: Toda operação de pedido é atômica

```typescript
await prisma.$transaction(async (tx) => {
  // 1. Recarrega o pedido no tenant e revalida saldo/estoque antes de qualquer mutation.
  const order = await tx.order.findFirstOrThrow({
    where: { id: orderId, schoolId: ctx.schoolId },
    include: { items: true },
  });
  const wallet = await tx.wallet.findFirstOrThrow({
    where: { userId: order.studentId, schoolId: ctx.schoolId },
  });

  if (wallet.balance < order.totalAmount) throw new InsufficientBalanceError()
  
  // 2. Verifica e reserva estoque
  for (const item of order.items) {
    await tx.inventoryItem.update({ where: ..., data: { quantity: { decrement: item.qty } } })
  }
  
  // 3. Debita saldo
  await tx.walletTransaction.create({ type: 'DEBIT', amount: order.totalAmount, ... })
  
  // 4. Confirma pedido
  await tx.order.update({ status: 'CONFIRMED', confirmedBy: ctx.userId, ... })
  
  // Se qualquer passo falhar, TUDO é revertido
})
```

### Regra 2: Idempotência em pagamentos

Toda operação de crédito tem `idempotency_key`. Se a chave já existe, a operação é
silenciosamente ignorada. Isso garante que webhook duplicado não credite duas vezes.

### Regra 3: Reserva antes de baixa no estoque

```
Pedido PENDING   → sem reserva financeira ou de estoque (rascunho do PDV)
Pedido CONFIRMED → inventory_move tipo RESERVE + wallet_transaction DEBIT
Pedido DELIVERED → inventory_move tipo OUT (baixa real)
Pedido CANCELLED → inventory_move tipo RELEASE (libera reserva)
```

Disponibilidade de produto = `quantity - reservas_ativas`

---

## Índices Críticos

```sql
-- Performance de queries de tenant
CREATE INDEX idx_orders_school_id ON orders(school_id);
CREATE INDEX idx_orders_student_id ON orders(student_id);
CREATE INDEX idx_wallet_transactions_wallet_id ON wallet_transactions(wallet_id);
CREATE INDEX idx_inventory_moves_product_id ON inventory_moves(product_id);

-- Busca de pedidos recentes (relatório diário)
CREATE INDEX idx_orders_created_at ON orders(school_id, created_at DESC);

-- Idempotência
CREATE UNIQUE INDEX idx_wallet_txn_idempotency ON wallet_transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX idx_payment_webhook_external ON payment_webhooks(provider, external_id)
  WHERE external_id IS NOT NULL;
```

---

## Estratégia de Migrations

1. Uma migration por mudança lógica
2. Toda migration tem operação de rollback documentada
3. Colunas novas sempre com DEFAULT ou NULLABLE
4. Nunca editar migration já aplicada em produção
5. Renomear coluna: criar nova → migrar dados → remover antiga (3 migrations separadas)
6. Convenção de nome: `YYYYMMDD_NNN_descricao_curta.sql`
