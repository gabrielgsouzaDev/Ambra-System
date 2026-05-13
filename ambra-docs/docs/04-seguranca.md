# 04 — Segurança

**Última atualização:** 12-05-2026
**Status:** Ativo

---

## Princípios

1. **Segurança por padrão.** Rotas são protegidas por padrão; exceções são explícitas.
2. **Defesa em profundidade.** Isolamento de tenant em duas camadas (aplicação + banco).
3. **Falhe com segurança.** Em caso de dúvida, rejeite. Nunca assuma permissão.
4. **Sem segredos no código.** Nenhuma variável sensível no repositório.

---

## Autenticação

### JWT com Refresh Token Rotation

- **Access token:** expiração 15 minutos, armazenado em memória no frontend
- **Refresh token:** expiração 7 dias, cookie `HttpOnly` + `Secure` + `SameSite=Strict`
- **Rotation:** ao usar refresh token, o atual é revogado e novo é emitido
- **Invalidação:** `sessionId` no payload permite revogar sessão no logout

```typescript
// Payload do JWT
interface JwtPayload {
  sub: string        // userId
  schoolId: string   // tenantId — presente em TODA operação
  role: UserRole     // papel no tenant
  sessionId: string  // para invalidação explícita
  iat: number
  exp: number
}
```

### Regras Invioláveis de Autenticação

- `JWT_SECRET` é obrigatório com no mínimo 32 caracteres; a aplicação recusa iniciar sem ele
- Nenhum fallback para valor hardcoded
- Nunca armazene token em `localStorage` ou cookie sem `HttpOnly`
- Blacklist de `sessionId` mantida em Redis para invalidação imediata

```typescript
// Validação no startup — aplicação não inicia sem isso
const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) {
  throw new Error('JWT_SECRET must be set and at least 32 characters. Aborting.');
}
```

---

## Autorização (RBAC)

### Papéis por Tenant

```typescript
enum UserRole {
  SCHOOL_ADMIN = 'SCHOOL_ADMIN',   // Gestor da escola
  CANTEEN_OP   = 'CANTEEN_OP',     // Operador de cantina / PDV
  GUARDIAN     = 'GUARDIAN',       // Responsável pelo aluno
  STUDENT      = 'STUDENT',        // Aluno (somente leitura)
}
```

### Guards Globais (aplicados a toda a aplicação)

```typescript
// app.module.ts — todos os guards em sequência
{ provide: APP_GUARD, useClass: JwtAuthGuard },   // autentica
{ provide: APP_GUARD, useClass: TenantGuard },    // isola tenant
{ provide: APP_GUARD, useClass: RolesGuard },     // verifica papel
```

**Rota pública:** requer `@Public()` explícito.
**Rota autenticada sem papel:** qualquer usuário autenticado do tenant acessa.
**Rota com papel:** requer `@Roles(UserRole.SCHOOL_ADMIN)`.

Nunca use `@Roles` sem os guards globais registrados — o erro do protótipo anterior.

### Matriz de Permissões do MVP

| Ação | SCHOOL_ADMIN | CANTEEN_OP | GUARDIAN | STUDENT |
|---|:---:|:---:|:---:|:---:|
| Gerenciar usuários da escola | ✓ | — | — | — |
| Gerenciar catálogo | ✓ | — | — | — |
| Reabastecer estoque | ✓ | ✓ | — | — |
| Criar pedido (PDV) | ✓ | ✓ | — | — |
| Cancelar pedido | ✓ | ✓ | — | — |
| Ver todos os pedidos da escola | ✓ | ✓ | — | — |
| Recarregar carteira de aluno | ✓ | — | ✓ | — |
| Ver extrato do aluno vinculado | ✓ | — | ✓ | ✓ |
| Configurar limites de gasto | ✓ | — | ✓ | — |
| Ver relatórios | ✓ | ✓ | — | — |
| Configurar escola | ✓ | — | — | — |
| Ajuste manual de saldo | ✓ | — | — | — |

---

## Isolamento Multi-Tenant

Duas camadas independentes. Se uma falhar, a outra protege.

Regra canônica: qualquer lookup em tabela de tenant com id vindo da request usa `findFirst` + `schoolId`. `findUnique`/`findUniqueOrThrow` não são o padrão nesses caminhos porque o middleware não injeta tenant em chave única.

### Camada 1: Prisma Middleware (aplicação)

```typescript
// Injeta schoolId em toda criação e leitura
prisma.$use(async (params, next) => {
  const tenantId = getTenantFromStore(); // AsyncLocalStorage
  
  // Bloqueia query sem contexto em tabelas de tenant
  if (!tenantId && TENANT_TABLES.includes(params.model)) {
    throw new Error(`[SECURITY] Query on ${params.model} without tenant context`);
  }
  
  if (tenantId) {
    // Injeta em criações
    if (params.action === 'create') {
      params.args.data.schoolId = tenantId;
    }
    // Injeta em leituras
    if (['findMany', 'findFirst', 'count'].includes(params.action)) {
      params.args.where = { ...params.args.where, schoolId: tenantId };
    }
  }
  
  return next(params);
});
```

### Camada 2: RLS PostgreSQL (banco)

```sql
-- Habilita RLS nas tabelas de tenant
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
-- ... demais tabelas de tenant

-- Policy: leitura e escrita apenas para o tenant ativo
CREATE POLICY tenant_isolation ON orders
  USING (school_id = current_setting('app.current_school_id', true)::uuid);

-- O middleware de banco seta o contexto por transação
SET LOCAL app.current_school_id = '<schoolId>';
```

### Testes Obrigatórios de Isolamento

Estes testes devem existir antes de qualquer deploy em produção:

```typescript
it('school A admin cannot read orders from school B')
it('school A operator cannot create order for school B student')
it('school A guardian cannot view school B wallet')
it('query without tenant context throws SecurityException')
it('cross-tenant product cannot be added to order')
```

---

## Proteção de APIs

### Validação de Entrada

```typescript
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,             // remove campos não declarados no DTO
  forbidNonWhitelisted: true,  // rejeita payload com campos extras
  transform: true,             // converte tipos
  disableErrorMessages: process.env.NODE_ENV === 'production',
}));
```

### Rate Limiting

| Endpoint | Limite | Janela |
|---|---|---|
| `POST /auth/login` | 5 req | 1 minuto por IP |
| `POST /auth/register` | 3 req | 1 minuto por IP |
| `POST /auth/refresh` | 10 req | 1 minuto por IP |
| `POST /payments/recharge` | 10 req | 1 minuto por usuário |
| `POST /orders` | 30 req | 1 minuto por usuário |
| `GET /catalog/products` | 100 req | 1 minuto por tenant |

### Headers de Segurança

```typescript
app.use(helmet());  // X-Frame-Options, X-XSS-Protection, etc.
app.enableCors({
  origin: process.env.ALLOWED_ORIGINS.split(','),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});
```

### Rotas Semi-Públicas: Webhooks

Algumas rotas não usam JWT, mas também não são públicas de verdade. O webhook do Asaas é o caso canônico.

Regras:
1. `@Public()` é obrigatório, porque não há token de usuário.
2. A assinatura HMAC é validada antes de qualquer leitura de domínio.
3. A primeira escrita é sempre um insert em `payment_webhooks`.
4. O tenant é resolvido depois, a partir do `payment_request` encontrado pelo `external_id` da cobrança.
5. Se o receipt já existe e já foi processado com sucesso, o evento é considerado duplicado e a resposta continua 200.
6. Se o receipt já existe mas está em `ERROR` ou sem `processed_at`, o mesmo registro pode ser reprocessado sem criar um novo crédito.
7. `200 OK` significa "recebido e registrado", não "processado com sucesso até o fim".

```typescript
@Post('webhook/asaas')
@Public()
async handleAsaasWebhook(
  @Headers('asaas-access-token') token: string,
  @RawBody() rawBody: Buffer,
  @Body() payload: unknown,
): Promise<{ received: boolean }> {
  // 1. Valida assinatura HMAC
  if (!this.verifyAsaasSignature(rawBody, token)) {
    throw new UnauthorizedException('Invalid webhook signature');
  }

  // 2. Grava o receipt ANTES de qualquer outra escrita.
  await this.registerWebhookReceipt(payload);

  // 3. Processa de forma idempotente e resolve o tenant a partir da cobrança.
  try {
    await this.processWebhook(payload);
  } catch (error) {
    await this.markWebhookAsFailed(payload, error);
  }

  // 4. Responde 200 assim que o receipt estiver registrado.
  return { received: true };
}
```

---

## Gestão de Secrets

### Hierarquia de Arquivos

```
.env.example    → template documentado (versionado, sem valores reais)
.env.local      → desenvolvimento local (NÃO versionado, nunca)
.env.test       → valores fake para testes (pode ser versionado)
# produção: variáveis de ambiente injetadas pelo Railway/AWS SSM
```

### Variáveis Obrigatórias

```bash
# Banco
DATABASE_URL=

# JWT — mínimo 32 caracteres, aleatório
JWT_SECRET=
JWT_REFRESH_SECRET=

# Asaas
ASAAS_API_KEY=
ASAAS_WEBHOOK_TOKEN=
ASAAS_BASE_URL=https://api.asaas.com/v3

# Redis
REDIS_URL=

# Email
RESEND_API_KEY=

# App
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:3000
```

### Checklist de Rotação (protótipo antigo)

- [ ] Rotacionar JWT_SECRET e JWT_REFRESH_SECRET
- [ ] Rotacionar chave de API do Asaas (sandbox e produção)
- [ ] Rotacionar credenciais de banco
- [ ] Executar `git filter-repo` para remover segredos do histórico git
- [ ] Revogar qualquer access token/API key que apareça no histórico

---

## LGPD

### Requisitos Mínimos para Operar

- [ ] Política de privacidade publicada e acessível
- [ ] Termos de uso e consentimentos LGPD registrados em banco (`user_consents` table)
- [ ] Dados de menores coletados somente com consentimento do responsável
- [ ] Endpoint de exportação de dados: `GET /api/v1/me/data-export`
- [ ] Endpoint de exclusão/anonimização: `DELETE /api/v1/me` (preserva histórico financeiro sem PII)
- [ ] Contato de DPO visível na política de privacidade

### Consentimentos Canônicos

A tabela `user_consents` deve registrar, no mínimo:

- `TERMS_OF_USE`
- `PRIVACY_POLICY`
- `GUARDIAN_AUTHORIZATION`

Revogação não apaga o registro. Ela usa `revoked_at` para manter trilha histórica.

### O que Não Armazenar

- Localização em tempo real
- Dados biométricos
- Histórico de navegação
- Dados desnecessários ao serviço (minimalismo de dados)

### Anonimização (não deleção)

Ao excluir conta, PII é anonimizado, não deletado.
Histórico financeiro é preservado para conformidade contábil.

```sql
-- Exemplo de anonimização
UPDATE profiles SET 
  name = 'Usuário Removido',
  document = NULL,
  phone = NULL,
  avatar_url = NULL
WHERE user_id = :userId;

UPDATE users SET
  email = CONCAT('removed_', id, '@deleted.ambra'),
  password_hash = 'REMOVED',
  status = 'DELETED'
WHERE id = :userId;
```

---

## Vulnerabilidades OWASP Top 10 — Mitigações

| Vulnerabilidade | Mitigação no Ambra |
|---|---|
| A01 Broken Access Control | TenantGuard + RolesGuard globais + RLS no banco |
| A02 Cryptographic Failures | HTTPS obrigatório, bcrypt para senhas, JWT com secret forte |
| A03 Injection | Prisma com queries parametrizadas; nunca string concat |
| A04 Insecure Design | Guards obrigatórios, sem fallback de secret, sem feature sem validação |
| A05 Security Misconfiguration | Variáveis obrigatórias no startup, Helmet, CORS restrito |
| A06 Vulnerable Components | Dependências auditadas com `npm audit` no CI |
| A07 Auth Failures | Rate limiting em login, refresh rotation, session invalidation |
| A08 Data Integrity | Transações Prisma, idempotência, ledger imutável |
| A09 Logging Failures | Auditoria append-only, logs estruturados sem dados sensíveis |
| A10 SSRF | Sem requisições a URLs fornecidas pelo usuário; apenas Asaas |
