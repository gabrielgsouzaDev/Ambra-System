# Ambra SaaS — Plano Arquitetural Completo
**Versão:** 1.0 | **Contexto:** Solo developer + IA, sem orçamento inicial, AWS como alvo futuro

---

## Premissas Inegociáveis

Antes de qualquer seção técnica, estas premissas governam todas as decisões abaixo:

1. **Você é um time de um.** Toda decisão que funciona bem para times de 5+ pessoas é uma decisão errada aqui.
2. **Sem orçamento inicial significa custo zero até o primeiro cliente pagante.** Não existe "vou pagar quando crescer" — a arquitetura precisa rodar de graça até receita.
3. **Complexidade é dívida, não ativo.** Cada abstração adicional é um custo de manutenção que você paga sozinho.
4. **O protótipo existente prova domínio do problema, não da solução.** Use-o como dicionário de domínio, não como base de código.

---

## 1. Arquitetura de Software

### 1.1 Decisão: Monólito Modular

**Escolha: Monólito modular com fronteiras de domínio claras.**

Microsserviços estão fora de questão. Não por limitação técnica — por realidade operacional. Microsserviços exigem infraestrutura distribuída, observabilidade complexa, gestão de falhas entre serviços e um time para manter. Com um desenvolvedor e zero receita, microsserviços são sabotagem autoinfligida.

O monólito modular resolve o problema real: você quer fronteiras claras para poder extrair serviços *quando e se* houver motivo de negócio, sem ser refém delas hoje.

**O que "monólito modular" significa na prática:**

Cada módulo é uma unidade de domínio com sua própria pasta, seus próprios tipos, sua própria interface pública e suas próprias regras. Módulos se comunicam por interfaces explícitas, nunca por importação direta de internals. O banco é compartilhado, o código é isolado. Se um dia você precisar extrair `payments` para um serviço separado, a fronteira já existe — você só move o código.

```
src/
├── modules/
│   ├── auth/          ← autenticação, sessões, tokens
│   ├── school/        ← tenant, escola, cantina, configurações
│   ├── users/         ← usuários, perfis, papéis
│   ├── catalog/       ← produtos, categorias, preços
│   ├── inventory/     ← estoque, reservas, movimentações
│   ├── orders/        ← pedidos, itens, status
│   ├── wallet/        ← carteira, saldo, transações
│   ├── payments/      ← Asaas, webhooks, recargas
│   └── reports/       ← relatórios, dashboards
├── shared/
│   ├── database/      ← Prisma client, migrations
│   ├── guards/        ← auth guard, roles guard, tenant guard
│   ├── middleware/    ← tenant context, request logging
│   ├── decorators/    ← @CurrentUser, @TenantId, @Roles
│   ├── pipes/         ← validação global
│   └── types/         ← tipos compartilhados
└── main.ts
```

**Regra de ouro de dependências:**

```
auth        → shared apenas
school      → auth, shared
users       → auth, school, shared
catalog     → school, shared
inventory   → catalog, school, shared
orders      → catalog, inventory, wallet, shared
wallet      → school, users, shared
payments    → wallet, shared
reports     → todos (read-only)
```

`reports` pode ler de qualquer módulo. Todos os outros têm direção definida. Nenhum módulo importa de um módulo "acima" dele nessa hierarquia.

### 1.2 Stack Tecnológico

**Backend: NestJS + TypeScript**

Mantenha o NestJS. O problema do protótipo não era o framework — era a ausência de disciplina arquitetural dentro dele. NestJS tem injeção de dependência, módulos, guards e pipes que, usados corretamente, implementam a arquitetura descrita acima com pouco esforço. Mudar para outro framework agora seria apenas trocar de vocabulário sem resolver nenhum problema real.

**Frontend: Next.js (App Router)**

Um único frontend Next.js serve os três públicos com rotas protegidas por papel:

```
/app/(auth)/login
/app/(auth)/register

/app/(tenant)/admin/         ← gestor da escola
/app/(tenant)/canteen/       ← operador de cantina / PDV
/app/(tenant)/parent/        ← responsável
/app/(tenant)/student/       ← aluno (view simplificada)
```

Por que não separar em três apps distintos? Porque você mantém três builds, três deploys, três bases de código e três conjuntos de bugs. Next.js com App Router e layouts por segmento resolve isso em um único repositório com separação clara.

**Banco de Dados: PostgreSQL**

PostgreSQL não é negociável para um sistema financeiro com multi-tenancy. JSON columns do MongoDB, eventual consistency do DynamoDB e a falta de transações ACID em soluções NoSQL são incompatíveis com carteira digital, estoque com reservas e auditoria financeira. Use o que resolve o problema.

**ORM: Prisma**

Mantenha Prisma. O schema legível, as migrations versionadas e o tipo-safe client são ativos reais. O problema do protótipo com Prisma não era o Prisma — era o schema sem invariantes.

**Cache: Redis**

Upstash Redis tem tier gratuito generoso (10.000 comandos/dia, depois $0.2/100K). Use para: sessions, rate limiting e cache de catálogo. Não use para estado financeiro — esse fica sempre no PostgreSQL.

### 1.3 Estratégia de API

**REST com OpenAPI, versionado desde o início.**

Não GraphQL. GraphQL resolve problemas de times grandes com muitos consumidores distintos de API. Para um SaaS escolar com frontends controlados por você, GraphQL adiciona complexidade de schema, resolver, N+1 e tooling sem benefício proporcional.

Versione desde o início: `/api/v1/`. Quando v2 existir, você saberá o motivo — e a v1 continuará funcionando para clientes existentes.

**Contrato de resposta padrão:**

```typescript
// Sucesso
{ data: T, meta?: { page, total, ... } }

// Erro
{ error: { code: string, message: string, details?: unknown } }
```

Nunca retorne estruturas diferentes para sucesso e erro. Nunca retorne arrays na raiz de uma resposta. Toda resposta é um objeto com `data` ou `error`. Isso facilita tratamento de erros no frontend e versionamento futuro.

**Rate limiting por rota:**

```
POST /auth/login          → 5 req/minuto por IP
POST /auth/register       → 3 req/minuto por IP
POST /payments/recharge   → 10 req/minuto por usuário
GET  /catalog/products    → 100 req/minuto por tenant
POST /orders              → 30 req/minuto por usuário
```

### 1.4 Estratégia Multi-Tenant

**Modelo: Shared Database, Row-Level Isolation com RLS do PostgreSQL.**

Existem três modelos de multi-tenancy:

| Modelo | Isolamento | Custo | Complexidade |
|---|---|---|---|
| DB por tenant | Total | Muito alto | Alta |
| Schema por tenant | Alto | Médio | Média |
| Row-level (RLS) | Médio | Baixo | Baixa |

Para o estágio atual: Row-Level Isolation com RLS. A razão é simples — você não tem dinheiro para bancos separados e não tem complexidade operacional para schemas separados. RLS do PostgreSQL, quando configurado corretamente, é uma segurança real no nível do banco, não apenas lógica de aplicação.

**Implementação do tenant context:**

```typescript
// Middleware que extrai o tenantId do JWT e injeta no contexto
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const tenantId = extractTenantFromJwt(req.headers.authorization);
    if (!tenantId) throw new UnauthorizedException();
    req['tenantId'] = tenantId;
    next();
  }
}

// Guard que verifica o tenant em TODA operação de banco
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const tenantId = request.tenantId;
    return user?.schoolId === tenantId;
  }
}
```

**Toda tabela de dados de tenant tem `school_id`:**

```sql
-- Em cada query, o Prisma middleware injeta automaticamente
WHERE school_id = current_setting('app.current_school_id')::uuid

-- RLS Policy (segunda linha de defesa)
CREATE POLICY tenant_isolation ON orders
  USING (school_id = current_setting('app.current_school_id')::uuid);
```

**O middleware de banco garante que NENHUMA query acontece sem tenant context:**

```typescript
// prisma.service.ts
prisma.$use(async (params, next) => {
  const tenantId = AsyncLocalStorage.getStore()?.tenantId;
  
  if (!tenantId && TENANT_REQUIRED_MODELS.includes(params.model)) {
    throw new Error(`Query on ${params.model} without tenant context`);
  }
  
  // Injeta school_id em todas as queries de criação
  if (params.action === 'create' && tenantId) {
    params.args.data.schoolId = tenantId;
  }
  
  // Injeta filtro em todas as queries de leitura
  if (['findMany', 'findFirst', 'count'].includes(params.action) && tenantId) {
    params.args.where = { ...params.args.where, schoolId: tenantId };
  }
  
  return next(params);
});
```

---

## 2. Arquitetura de Dados

### 2.1 Modelagem do Banco

**Domínios e suas tabelas principais:**

```sql
-- TENANT / ESCOLA
schools          id, name, cnpj, slug, plan, status, settings(jsonb), created_at
canteens         id, school_id, name, status, created_at

-- USUÁRIOS
users            id, school_id, email, password_hash, role, status, created_at
profiles         id, user_id, name, document, phone, avatar_url
students         id, school_id, profile_id, registration_code, grade, class

-- RESPONSÁVEIS ↔ ALUNOS
guardians        id, user_id, student_id, relationship, spending_limit_daily, blocked_categories
-- Um usuário pode ser responsável de múltiplos alunos
-- Um aluno pode ter múltiplos responsáveis

-- CATÁLOGO
categories       id, school_id, name, slug, is_active
products         id, school_id, category_id, name, price, image_url, is_active, allergens(jsonb)

-- ESTOQUE
inventory_items  id, school_id, product_id, quantity, min_quantity, updated_at
inventory_moves  id, school_id, product_id, type(IN/OUT/ADJUST/RESERVE/RELEASE), quantity, 
                 order_id, reason, created_by, created_at
-- NUNCA alterar quantity diretamente. Sempre via inventory_move com trigger.

-- CARTEIRA
wallets          id, school_id, user_id, balance(decimal 10,2), updated_at
-- balance é calculado via trigger, nunca escrito diretamente pela aplicação
wallet_transactions  id, school_id, wallet_id, type(CREDIT/DEBIT), amount, 
                     balance_after, source(ORDER/RECHARGE/REFUND/ADJUSTMENT),
                     reference_id, description, created_at, idempotency_key
-- Imutável. Nunca UPDATE ou DELETE. Apenas INSERT.

-- PEDIDOS
orders           id, school_id, student_id, created_by, confirmed_by, status, total_amount,
                 notes, created_at, updated_at
order_items      id, order_id, product_id, quantity, unit_price, subtotal
order_status_history  id, order_id, from_status, to_status, changed_by, reason, created_at
-- status: PENDING → CONFIRMED → DELIVERED | CANCELLED

-- PAGAMENTOS EXTERNOS
payment_requests  id, school_id, wallet_id, amount, provider(ASAAS),
                  external_id, status, pix_code, expires_at, paid_at,
                  idempotency_key, created_at
payment_webhooks  id, provider, external_id, event_type, payload(jsonb), processed_at,
                  processing_result(SUCCESS/ERROR/IGNORED), error_message, created_at
-- Receipt de todos os webhooks recebidos antes de qualquer processamento

-- AUDITORIA
audit_logs       id, school_id, user_id, action, entity_type, entity_id,
                 old_value(jsonb), new_value(jsonb), ip, user_agent, created_at
```

### 2.2 Invariantes de Dados Críticos

Estas regras nunca são violadas. Se o código tentar violá-las, o banco rejeita:

```sql
-- 1. Saldo nunca negativo (a menos que seja conta de escola, não de aluno)
ALTER TABLE wallets ADD CONSTRAINT wallet_balance_non_negative
  CHECK (balance >= 0);

-- 2. Quantidade de estoque nunca negativa
ALTER TABLE inventory_items ADD CONSTRAINT inventory_non_negative
  CHECK (quantity >= 0);

-- 3. Preço de produto nunca negativo
ALTER TABLE products ADD CONSTRAINT product_price_positive
  CHECK (price >= 0);

-- 4. Valor de transação sempre positivo (o tipo indica direção)
ALTER TABLE wallet_transactions ADD CONSTRAINT transaction_amount_positive
  CHECK (amount > 0);

-- 5. Total do pedido bate com soma dos itens (trigger de validação)
CREATE OR REPLACE FUNCTION validate_order_total()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.total_amount != (
    SELECT COALESCE(SUM(subtotal), 0) FROM order_items WHERE order_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Order total does not match items sum';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### 2.3 Fluxo Financeiro: Regras de Ouro

**Regra 1: Saldo é sempre calculado, nunca escrito.**

```sql
-- O saldo da carteira é recalculado por trigger a cada transação
CREATE OR REPLACE FUNCTION update_wallet_balance()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE wallets SET balance = (
    SELECT COALESCE(SUM(
      CASE WHEN type = 'CREDIT' THEN amount ELSE -amount END
    ), 0)
    FROM wallet_transactions
    WHERE wallet_id = NEW.wallet_id
  ), updated_at = NOW()
  WHERE id = NEW.wallet_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Regra 2: Toda operação financeira tem `idempotency_key`.**

O webhook do Asaas pode ser entregue mais de uma vez. Sem idempotência, você credita duas vezes. Toda operação de crédito/débito recebe uma chave única antes de ser executada. O receipt em `payment_webhooks` é gravado antes do processamento; `SUCCESS`/`IGNORED` é terminal, enquanto `ERROR` pode ser reprocessado sem criar novo crédito.

**Regra 3: Reserva de estoque é separada de baixa.**

```
Pedido PENDING → rascunho sem reserva
Pedido CONFIRMED → RESERVA + débito de carteira
Pedido DELIVERED → BAIXA (reserva vira consumo real)
Pedido CANCELLED → LIBERAÇÃO apenas se já estava CONFIRMED
```

Nunca debite estoque no rascunho do pedido. A reserva acontece na confirmação, dentro da mesma transação do débito de carteira.

### 2.4 Estratégia de Migrations

**Regras:**

1. Uma migration por mudança lógica. Nunca agrupe alterações não relacionadas.
2. Toda migration é reversível. Escreva o `down` antes de fazer deploy.
3. Colunas novas sempre com valor default ou nullable. Nunca adicione `NOT NULL` sem default em tabela com dados.
4. Nunca renomeie coluna diretamente. Crie coluna nova → migre dados → remova coluna antiga (em três deploys separados).
5. Mantenha a pasta `migrations/` versionada e nunca edite uma migration já aplicada em produção.

```
migrations/
├── 20240101_001_init_schema.sql
├── 20240101_002_add_rls_policies.sql
├── 20240115_003_add_payment_webhooks.sql
└── ...
```

### 2.5 Estratégia de Cache

**Cache apenas onde a leitura é cara e a escrita é infrequente:**

| O que cachear | TTL | Invalidação |
|---|---|---|
| Catálogo de produtos por escola | 5 min | Ao salvar produto |
| Configurações da escola | 15 min | Ao salvar configuração |
| Sessão de usuário | 24h | Ao fazer logout |
| Rate limit counters | 1 min | Expira naturalmente |

**O que NUNCA cachear:**

- Saldo de carteira
- Disponibilidade de estoque
- Status de pedido

Qualquer dado financeiro ou operacional em tempo real vem sempre do banco.

### 2.6 Auditoria

Toda ação que modifica dados financeiros, de usuário ou de configuração é auditada. A tabela `audit_logs` é append-only — nunca há UPDATE ou DELETE nela.

**O que auditar obrigatoriamente:**

- Login, logout, tentativa de login falha
- Criação, alteração e cancelamento de pedido
- Qualquer transação de carteira
- Recarga via pagamento externo
- Alteração de saldo por administrador
- Alteração de permissões de usuário
- Criação e desativação de produto
- Ajuste de estoque manual

---

## 3. Arquitetura de Segurança

### 3.1 Autenticação

**JWT com refresh token rotation.**

- Access token: 15 minutos de expiração, armazenado em memória no frontend (nunca localStorage).
- Refresh token: 7 dias, armazenado em cookie HttpOnly + Secure + SameSite=Strict.
- Ao usar o refresh token, ele é revogado e um novo é emitido (rotation). Token roubado é invalidado no próximo uso legítimo.

```typescript
// Estrutura do JWT payload
interface JwtPayload {
  sub: string;          // userId
  schoolId: string;     // tenantId
  role: UserRole;       // papel no tenant
  sessionId: string;    // para invalidação explícita
  iat: number;
  exp: number;
}
```

**Nunca armazene `JWT_SECRET` com fallback. A aplicação deve recusar iniciar se a variável não estiver definida:**

```typescript
// config/auth.config.ts
export const authConfig = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be defined and at least 32 characters');
  }
  return { secret, accessTokenExpiry: '15m', refreshTokenExpiry: '7d' };
};
```

### 3.2 Autorização e RBAC

**Papéis por tenant (não globais):**

```typescript
enum UserRole {
  SCHOOL_ADMIN  = 'SCHOOL_ADMIN',   // Gestor da escola
  CANTEEN_OP    = 'CANTEEN_OP',     // Operador de cantina / PDV
  GUARDIAN      = 'GUARDIAN',       // Responsável pelo aluno
  STUDENT       = 'STUDENT',        // Aluno (apenas visualização)
}

// Papel global (fora de tenant, apenas para você)
enum SystemRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
}
```

**Guard aplicado globalmente, não por rota:**

```typescript
// app.module.ts — guard aplicado em TODA a aplicação
{
  provide: APP_GUARD,
  useClass: JwtAuthGuard,  // autentica
},
{
  provide: APP_GUARD,
  useClass: TenantGuard,   // isola tenant
},
{
  provide: APP_GUARD,
  useClass: RolesGuard,    // verifica papel
},
```

Rotas públicas recebem o decorator `@Public()`. Rotas com RBAC recebem `@Roles(UserRole.SCHOOL_ADMIN)`. Se não há decorator, a rota exige apenas autenticação válida. Nunca confie em `@Roles` sem o `RolesGuard` estar registrado globalmente — o erro do protótipo.

**Matriz de permissões:**

| Ação | SCHOOL_ADMIN | CANTEEN_OP | GUARDIAN | STUDENT |
|---|:---:|:---:|:---:|:---:|
| Gerenciar usuários | ✓ | — | — | — |
| Gerenciar catálogo | ✓ | — | — | — |
| Gerenciar estoque | ✓ | ✓ | — | — |
| Criar/entregar pedido | ✓ | ✓ | — | — |
| Ver pedidos da escola | ✓ | ✓ | — | — |
| Recarregar carteira | ✓ | — | ✓ | — |
| Ver saldo/extrato próprio | ✓ | ✓ | ✓ | ✓ |
| Ver relatórios | ✓ | ✓ | — | — |
| Configurar escola | ✓ | — | — | — |

### 3.3 Proteção de APIs

**Validação de entrada sempre no servidor:**

Nunca confie em validação do frontend. Todo DTO tem decorators do `class-validator`. Pipe global rejeita qualquer payload que não passe na validação:

```typescript
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,       // remove campos não declarados no DTO
  forbidNonWhitelisted: true,  // rejeita se tiver campo extra
  transform: true,       // converte tipos automaticamente
  disableErrorMessages: process.env.NODE_ENV === 'production',
}));
```

**CORS restrito:**

```typescript
app.enableCors({
  origin: process.env.ALLOWED_ORIGINS.split(','),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
});
```

**Helmet para headers de segurança:**

```typescript
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"] } },
  crossOriginEmbedderPolicy: false, // necessário para alguns recursos PWA
}));
```

### 3.4 Gestão de Secrets

**Hierarquia de ambientes:**

```
.env.local          → desenvolvimento local (não versionado, nunca)
.env.test           → testes (valores fake, pode ser versionado)
.env.example        → template documentado (versionado, sem valores reais)
```

Em produção, os secrets vêm de variáveis de ambiente injetadas pelo serviço de deploy (Railway, Render, AWS SSM). Nunca há arquivo `.env` em produção.

**Checklist de rotação imediata do protótipo:**

- [ ] Todos os JWT_SECRETs
- [ ] Chaves de API do Asaas (sandbox e produção separadas)
- [ ] Credenciais de banco
- [ ] Qualquer senha/token versionado no git histórico (`git filter-repo` para remover)

### 3.5 Proteção contra Vulnerabilidades Comuns

**OWASP Top 10 aplicado ao contexto:**

| Vulnerabilidade | Mitigação |
|---|---|
| Injection (SQL) | Prisma com parameterized queries. Nunca string concat em query. |
| Broken Auth | JWT rotation, guard global, session invalidation |
| IDOR | Filtro automático de `schoolId` no Prisma middleware |
| Security Misconfiguration | Variáveis obrigatórias no startup, Helmet |
| Sensitive Data Exposure | HTTPS obrigatório, logs sem dados sensíveis |
| Mass Assignment | `whitelist: true` no ValidationPipe |
| Rate Limiting | Por rota, por usuário e por IP |

**Proteção de webhooks (Asaas):**

```typescript
// Verificar assinatura HMAC em todo webhook recebido
@Post('webhook')
@Public()  // fora da auth normal
async handleWebhook(
  @Headers('asaas-access-token') signature: string,
  @Body() payload: unknown,
  @RawBody() rawBody: Buffer,
) {
  const isValid = this.paymentsService.verifyWebhookSignature(rawBody, signature);
  if (!isValid) throw new UnauthorizedException('Invalid webhook signature');
  
  // Receipt primeiro, processamento idempotente depois
  await this.paymentsService.registerWebhookReceipt(payload);
  try {
    await this.paymentsService.processWebhook(payload);
  } catch (error) {
    await this.paymentsService.markWebhookAsFailed(payload, error);
  }
  
  return { received: true };  // 200 significa recebido e registrado
}
```

### 3.6 LGPD

**Dados de menores exigem atenção especial:**

- Dados de alunos (menores de idade) só são coletados com consentimento explícito do responsável.
- Armazene o aceite dos termos e autorizações em `user_consents`: `subject_user_id`, `consented_by_user_id`, `consent_type`, `version`, `accepted_at`, `revoked_at`, `ip`.
- Implemente `GET /api/v1/me/data-export` para direito de portabilidade.
- Implemente `DELETE /api/v1/me` com anonimização (não deleção — preserve histórico financeiro sem PII).
- Não armazene dados biométricos, localização ou dados desnecessários ao serviço.
- Tenha um endereço de contato para DPO visível na política de privacidade.

---

## 4. Arquitetura de Infraestrutura

### 4.1 Estratégia por Fase (custo como restrição real)

**Fase 0 — Desenvolvimento (custo: R$ 0)**

| Serviço | Opção | Custo |
|---|---|---|
| Backend | Railway (free tier: 500h/mês) | Grátis |
| Frontend | Vercel (free tier) | Grátis |
| Banco | Railway PostgreSQL (1GB) | Grátis |
| Cache | Upstash Redis (10K req/dia) | Grátis |
| Armazenamento | Cloudflare R2 (10GB/mês) | Grátis |
| Email | Resend (3.000 emails/mês) | Grátis |
| CI/CD | GitHub Actions (2.000 min/mês) | Grátis |

**Fase 1 — Piloto (1–5 escolas, custo estimado: R$ 50–150/mês)**

| Serviço | Opção | Custo estimado |
|---|---|---|
| Backend | Railway Starter ($5/mês) | ~R$ 25 |
| Banco | Railway PostgreSQL ($5/mês) | ~R$ 25 |
| Frontend | Vercel (ainda free) | Grátis |
| Cache | Upstash Redis Pay-as-you-go | ~R$ 5 |
| Storage | Cloudflare R2 | ~R$ 5 |
| Email | Resend | Grátis |

**Fase 2 — Tração (5–50 escolas, migração para AWS)**

Apenas quando houver receita cobrindo a infra. O motivo de migrar para AWS não é "AWS é melhor" — é que a AWS oferece controle granular, SLAs garantidos e serviços gerenciados que justificam o custo quando você tem volume real.

```
AWS Target Architecture (Fase 2):
├── ECS Fargate (backend — sem gerenciar EC2)
├── RDS PostgreSQL Multi-AZ (banco com failover)
├── ElastiCache Redis (cache gerenciado)
├── S3 + CloudFront (assets e uploads)
├── SES (email transacional)
├── SSM Parameter Store (secrets)
├── CloudWatch (logs e métricas)
└── Route 53 (DNS)
```

**Por que não AWS desde o início?**

Porque configurar VPC, security groups, IAM, ECS task definitions, ALB e RDS do zero tem custo de aprendizado e tempo de setup que não se justifica antes de validar o produto. Railway + Vercel permitem deploy em minutos com segurança razoável. Migre para AWS quando o custo da simplicidade for maior que o custo da complexidade.

### 4.2 CI/CD

**Pipeline GitHub Actions:**

```yaml
# .github/workflows/backend.yml
name: Backend CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run lint
      - run: npm run type-check
      - run: npm run test:unit
      - run: npm run test:integration
        env:
          DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}

  deploy-staging:
    needs: validate
    if: github.ref == 'refs/heads/develop'
    runs-on: ubuntu-latest
    steps:
      - run: railway deploy --environment staging

  deploy-production:
    needs: validate
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: railway deploy --environment production
```

**Branch strategy simples para time de um:**

```
main        → produção (protegida, merge apenas via PR)
develop     → staging (integração contínua)
feat/xyz    → feature branches (criadas a partir de develop)
fix/xyz     → hotfix (criadas a partir de main, merge em main + develop)
```

Não use GitFlow completo. É overhead para solo developer. Essa estrutura é suficiente.

### 4.3 Ambientes

**Três ambientes, três bancos separados:**

```
local      → .env.local, banco Docker local
staging    → Railway/develop, banco staging (dados de teste)
production → Railway/main ou AWS, banco production (dados reais)
```

Regra inviolável: **nunca use dados reais em staging**. Nunca acesse o banco de produção diretamente do seu laptop.

### 4.4 Observabilidade

**Logging estruturado com Pino:**

```typescript
// Todos os logs são JSON estruturado
logger.info({ 
  action: 'order.created',
  orderId: order.id,
  schoolId: tenant.id,
  amount: order.total,
  // NUNCA: email, senha, token, CPF, dados de pagamento
});
```

**Métricas mínimas para acompanhar:**

- Taxa de erro por endpoint (> 1% é alerta)
- Latência p95 por endpoint (> 500ms é investigar)
- Taxa de falha de pagamento (> 5% é crítico)
- Estoque zerado sem alerta prévio (operacional)

**Ferramentas gratuitas para começar:**

- Logs: Railway/Render têm log streaming nativo
- Erros: Sentry (free tier: 5K errors/mês)
- Uptime: BetterUptime ou UptimeRobot (free)

### 4.5 Backups

**PostgreSQL:**

- Backup diário automático via `pg_dump` → S3/R2 (Railway faz isso automaticamente)
- Retenção de 30 dias
- Teste de restore mensalmente — backup sem teste de restore é ilusão de segurança

---

## 5. Arquitetura de Negócio

### 5.1 Núcleo Mínimo Vendável (o que precisa existir para vender)

Para uma escola pagar pelo produto, ela precisa resolver **exatamente este problema**:

> *O recreio é caótico, há fila, os alunos perdem dinheiro físico, os pais não sabem o que os filhos comem e a cantina não sabe quantos salgados preparar.*

O produto resolve isso se e somente se:

1. **Responsável recarrega carteira pelo celular via PIX** — sem isso, o produto não existe.
2. **Aluno chega no caixa, operador seleciona itens, confirma com saldo** — sem isso, o produto não tem uso diário.
3. **Estoque diminui automaticamente** — sem isso, a cantina não confia.
4. **Gestor vê o que vendeu no dia** — sem isso, não há argumento de valor para a escola.

Tudo fora desses quatro não é MVP. É roadmap.

### 5.2 Features do MVP (o que entra)

**MUST HAVE — sem isso não abre:**

- [ ] Cadastro de escola e cantina
- [ ] Cadastro de operador, gestor, responsável, aluno
- [ ] Vinculação responsável ↔ aluno
- [ ] Catálogo de produtos com preço e estoque
- [ ] Carteira digital por aluno
- [ ] Recarga via PIX (Asaas)
- [ ] PDV simples: selecionar aluno, montar pedido, confirmar
- [ ] Débito automático do saldo na confirmação
- [ ] Reserva e baixa de estoque por pedido
- [ ] Histórico de transações (responsável vê)
- [ ] Relatório diário simples (gestor vê)
- [ ] Notificação de saldo baixo por email

**SHOULD HAVE — entra se não atrasar o piloto:**

- [ ] Limite de gasto diário por responsável
- [ ] Bloqueio de categorias por responsável
- [ ] Extrato detalhado com filtro de data
- [ ] Relatório de estoque

**WON'T HAVE no MVP — congelado:**

- Aplicativo nativo (iOS/Android)
- IA nutricional
- Integração fiscal (NFC-e, SAT)
- B2G / escola pública
- Módulo de risco / Serasa
- Assinatura premium B2C
- Cupons e descontos
- White-label
- Multi-cantina complexa
- Console global de super-admin

### 5.3 Modelo de Precificação (decisão que precisa ser tomada)

Três modelos possíveis com trade-offs distintos:

**Opção A — Mensalidade por escola**

```
R$ 150–300/mês por escola
+ Taxa de implantação única: R$ 500–1.000
```

*Prós:* receita previsível, alinha incentivo (você quer que a escola use mais).
*Contras:* harder sell, escola paga mesmo sem uso intenso.

**Opção B — Taxa por transação**

```
0,5–1% por recarga via PIX
```

*Prós:* fácil de vender ("só paga se usar"), sem barreira de entrada.
*Contras:* receita variável, depende do volume, pode irritar em escala.

**Opção C — Híbrido (recomendado para piloto)**

```
R$ 0/mês durante o piloto (30 dias)
R$ 99/mês após piloto (plano único, sem features travadas)
```

Oferecer piloto gratuito reduz a fricção de entrada. Preço único elimina confusão de planos. Começa simples — você pode sofisticar depois.

### 5.4 Como Evitar Overengineering Novamente

**O checklist anti-overengineering (use antes de implementar qualquer coisa):**

1. **Qual problema real do piloto isso resolve?** Se a resposta não cabe em uma frase, não implemente agora.
2. **Uma escola piloto pediu isso?** Se não, é hipótese — valide antes de construir.
3. **Isso bloqueia o primeiro cliente de pagar?** Se não, vai para o backlog.
4. **Posso implementar a versão mais simples que funciona?** Se a versão simples resolve, não construa a versão elegante.
5. **Qual o custo de não ter isso agora?** Se a resposta for "nenhum", não implemente.

---

## 6. Planejamento de Execução

### 6.1 Ordem de Implementação

**Fase 1 — Fundação (Semanas 1–2): zero feature, só infraestrutura**

```
Semana 1:
├── Novo repositório (monorepo Turborepo ou simples packages/)
├── NestJS com estrutura de módulos definida
├── Prisma + PostgreSQL (local via Docker)
├── Autenticação completa (JWT + refresh + guard global)
├── Middleware de tenant + Prisma middleware de isolamento
├── ValidationPipe global + error handler global
└── Setup de testes (Jest + Supertest)

Semana 2:
├── Next.js com App Router e layouts por papel
├── Sistema de autenticação do frontend (sem localStorage)
├── CI/CD básico (GitHub Actions → Railway)
├── .env.example documentado
├── README com setup local em < 5 minutos
└── Primeiro teste de integração end-to-end passando
```

Não avance para Fase 2 sem: autenticação funcionando, tenant isolation testado, pipeline de CI verde.

**Fase 2 — Domínio Core (Semanas 3–5)**

```
Semana 3:
├── Módulo school: CRUD escola, cantina
├── Módulo users: CRUD usuários por papel
├── Módulo catalog: produtos, categorias
└── Testes de RBAC para cada papel em cada endpoint

Semana 4:
├── Módulo inventory: estoque, reservas, movimentações
├── Módulo wallet: carteira, transações (sem pagamento externo ainda)
└── Testes de invariante (saldo negativo, estoque negativo)

Semana 5:
├── Módulo orders: pedido completo (criar → confirmar → entregar → cancelar)
├── Integração wallet ↔ orders (débito na confirmação)
├── Integração inventory ↔ orders (reserva → baixa → liberação)
└── Teste de concorrência: 10 pedidos simultâneos no mesmo produto
```

**Fase 3 — Pagamentos (Semanas 6–7)**

```
Semana 6:
├── Módulo payments: integração Asaas
├── Geração de cobrança PIX
├── Recebimento e validação de webhook
├── Idempotência no processamento de webhook
└── Teste: webhook duplicado não credita duas vezes

Semana 7:
├── Frontend de recarga (responsável)
├── Frontend PDV (operador)
├── Testes e2e do fluxo completo
└── Validação manual: responsável recarrega → aluno compra → gestor vê
```

**Fase 4 — Interface Completa + Piloto (Semanas 8–10)**

```
Semanas 8–9:
├── Dashboard do gestor com relatório diário
├── Extrato do responsável
├── Tela de catálogo/estoque para gestor
└── Notificação de saldo baixo (email)

Semana 10:
├── Hardening de segurança (revisão de permissões, rate limiting)
├── Smoke tests em staging
├── Onboarding da primeira escola piloto
└── Monitoramento de erros ativo (Sentry)
```

### 6.2 Estrutura de Repositório

```
ambra/
├── apps/
│   ├── api/              ← NestJS backend
│   └── web/              ← Next.js frontend
├── packages/
│   └── types/            ← tipos compartilhados (DTOs, enums)
├── docker-compose.yml    ← PostgreSQL + Redis local
├── .env.example
├── README.md
└── turbo.json            ← ou package.json com workspaces
```

### 6.3 Estratégia de Testes

**Pirâmide de testes:**

```
         [E2E]
       (poucos, lentos)
      fluxos críticos completos

     [Integration]
    (moderados, médios)
   módulos + banco real de teste

  [Unit]
 (muitos, rápidos)
serviços, regras de negócio, utils
```

**Testes obrigatórios antes de qualquer deploy em produção:**

```typescript
// Categoria 1: Invariantes financeiros
it('should not allow negative wallet balance')
it('should not process duplicate webhook (idempotency)')
it('should rollback order if wallet debit fails')
it('should release inventory reservation on order cancellation')

// Categoria 2: Isolamento multi-tenant
it('school A cannot read orders from school B')
it('school A cannot modify products from school B')
it('operator cannot access data from another school')

// Categoria 3: RBAC
it('guardian cannot create orders')
it('student cannot access admin routes')
it('canteen operator cannot modify catalog')

// Categoria 4: Concorrência
it('concurrent orders should not oversell inventory')
it('concurrent recharges with same idempotency key should credit only once')
```

### 6.4 Definition of Done

Um item de backlog está pronto quando:

- [ ] Código revisado (mesmo que por você mesmo, no dia seguinte)
- [ ] Testes unitários cobrindo regras de negócio do item
- [ ] Testes de integração cobrindo o endpoint ou serviço
- [ ] Sem TypeScript errors (`tsc --noEmit` limpo)
- [ ] Sem linting errors
- [ ] Sem variável de ambiente não documentada no `.env.example`
- [ ] Pipeline CI verde
- [ ] Documentação de endpoint atualizada (OpenAPI/Swagger)

### 6.5 Consistência Arquitetural no Crescimento

**O problema futuro:** quando o projeto crescer, novas features vão começar a violar as fronteiras definidas.

**Como prevenir:**

1. **ADR (Architecture Decision Records):** Documente cada decisão arquitetural relevante em `docs/adr/`. Quando você (ou uma IA ajudando) quiser fazer diferente, consulte o ADR antes.

```
docs/
└── adr/
    ├── 001-monolith-modular.md
    ├── 002-jwt-refresh-rotation.md
    ├── 003-row-level-multitenancy.md
    └── 004-wallet-immutable-ledger.md
```

2. **Linting de arquitetura:** Considere `dependency-cruiser` para garantir que módulos não importem de onde não deveriam.

3. **Checklist de nova feature:** Antes de implementar qualquer coisa nova, responda: em qual módulo entra? Viola alguma fronteira existente? Cria novo domínio ou estende existente?

---

## 7. Análise Crítica: Perguntas Difíceis

### 7.1 Complexidade Desnecessária a Evitar

**Não implemente sistema de filas no MVP.**

RabbitMQ, Bull, SQS — tudo isso é prematuramente complexo. O webhook do Asaas pode ser processado de forma síncrona com tratamento de retry no próprio handler. Filas fazem sentido quando você tem volume que justifica processamento assíncrono. Você não tem isso ainda.

**Não implemente event sourcing.**

É uma pattern elegante para auditoria financeira, mas tem overhead enorme de complexidade. O ledger imutável de transações (tabela `wallet_transactions` append-only) dá 90% dos benefícios sem nenhum overhead.

**Não abstraia o Asaas com uma interface genérica de gateway.**

"E se um dia trocar o Asaas?" é uma pergunta válida — no dia em que você trocar. Por enquanto, o módulo `payments` chama o Asaas diretamente com uma camada de serviço clara. Se trocar de gateway, você reescreve o serviço. Abstrair antes é pagar pelo custo de manutenção de uma interface que só tem uma implementação.

**Não use CQRS no MVP.**

Separar leitura de escrita tem benefício quando as operações de leitura e escrita têm requisitos drasticamente diferentes. No MVP, não têm.

### 7.2 Riscos Arquiteturais Reais

**Risco 1: Débito e reserva de estoque sem transação.**

Se o débito da carteira suceder mas a baixa do estoque falhar (ou vice-versa), você tem inconsistência financeira. Toda operação de pedido precisa estar em uma única transação Prisma:

```typescript
await prisma.$transaction(async (tx) => {
  await tx.walletTransaction.create({ ... });   // débita carteira
  await tx.inventoryMove.create({ ... });        // baixa estoque
  await tx.order.update({ status: 'CONFIRMED' }); // confirma pedido
  // Se qualquer operação falhar, tudo é revertido
});
```

**Risco 2: Webhook recebido sem escola resolvida.**

O webhook do Asaas não carrega `schoolId`. Você precisa registrar o receipt em `payment_webhooks` primeiro e depois resolver o tenant pela cobrança em `payment_requests.external_id` antes de creditar a carteira. Se esse lookup falhar, o receipt permanece retriable e nenhum crédito é executado.

**Risco 3: Crescimento de dados de auditoria.**

A tabela `audit_logs` vai crescer indefinidamente. Defina uma política de retenção: dados de auditoria operacional ficam 1 ano na tabela principal, depois são arquivados para S3 em Parquet. Implemente isso antes de atingir 1 milhão de registros.

**Risco 4: Dependência total do Asaas.**

Se o Asaas sofrer downtime, o produto para de aceitar recargas. Implemente estado de degradação gracioso: o sistema continua funcionando para pedidos com saldo existente, mas exibe "recarga temporariamente indisponível" em vez de quebrar.

### 7.3 Decisões Prematuras que Devem Ser Evitadas

| Decisão | Por que é prematura | Quando decide |
|---|---|---|
| Multi-cantina por escola | Primeira escola provavelmente tem uma cantina | Quando um cliente pedir |
| Planos de assinatura com features diferentes | Confunde o piloto | Quando tiver > 20 clientes |
| Integração fiscal (NFC-e) | Nem toda cantina precisa | Quando for exigência legal do cliente |
| App nativo | PWA é suficiente para validar | Quando PWA for gargalo de adoção |
| Sistema de notificações push | Email resolve o problema agora | Quando usuários reclamarem de email |
| Múltiplos gateways de pagamento | Asaas resolve o PIX | Quando Asaas for um problema |

### 7.4 Tecnologias que Você Pode Estar Considerando e Não Deve Usar Agora

**Docker em produção (gerenciado por você):**
Use Railway/Render que gerenciam containers por você. Operar Docker em produção sozinho é overhead operacional desnecessário neste estágio.

**Kubernetes:**
Não. Isso não é nem questão de fase — é anos de desenvolvimento à frente.

**TypeORM em vez de Prisma:**
Prisma tem DX superior e você já conhece. Não mude de ORM sem motivo técnico claro.

**MongoDB:**
A modelagem relacional do problema (carteira, transações, estoque, pedidos) é genuinamente relacional. MongoDB aqui seria uma escolha ideológica, não técnica.

**Next.js API Routes como backend:**
Tentador porque elimina um serviço. Mas mistura frontend e backend cria dificuldade de manutenção, testa mal e não escala independentemente. Backend separado é a escolha certa.

---

## Sumário Executivo

| Dimensão | Decisão |
|---|---|
| Arquitetura | Monólito modular com fronteiras de domínio |
| Backend | NestJS + TypeScript + Prisma |
| Frontend | Next.js (App Router, um app, múltiplos layouts) |
| Banco | PostgreSQL com RLS para multi-tenancy |
| Cache | Upstash Redis (gratuito no início) |
| Auth | JWT access (15min) + refresh rotation (HttpOnly cookie) |
| Multi-tenant | Row-level com Prisma middleware + RLS como segunda camada |
| Pagamentos | Asaas (PIX) com idempotência em webhooks |
| Infra inicial | Railway (backend) + Vercel (frontend) — custo zero |
| Infra futura | AWS ECS + RDS + ElastiCache quando houver receita |
| CI/CD | GitHub Actions |
| Repositório | Novo, monorepo simples (apps/api + apps/web) |
| MVP scope | Auth, escola, usuários, catálogo, estoque, carteira, PIX, PDV, relatório |
| Congelado | IA, B2G, fiscal, native app, risk, coupons, white-label |

**O critério de "pronto para pilotar":**
O sistema está pronto para piloto quando um responsável consegue recarregar R$ 50 via PIX, o saldo aparece em menos de 30 segundos, um operador consegue criar e confirmar um pedido de R$ 12 debitando o saldo correto, o estoque decresce corretamente, e o gestor vê a venda no relatório do dia — tudo isso sem erro, em três tentativas consecutivas com dois operadores simultâneos.

---

*Este documento é um plano vivo. Quando uma decisão mudar, atualize o ADR correspondente e registre o motivo.*
