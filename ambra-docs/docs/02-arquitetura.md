# 02 — Arquitetura

**Última atualização:** 12-05-2026
**Status:** Ativo

---

## Decisão Central: Monólito Modular

**Escolha:** Monólito modular com fronteiras de domínio claras e explícitas.

**Motivo:** Time de um desenvolvedor, zero receita inicial, validação de produto em andamento. Microsserviços exigem infraestrutura distribuída e overhead operacional incompatíveis com esta fase. O monólito modular permite extrair serviços no futuro sem reescrita, pois as fronteiras existem no código mesmo que não existam na infraestrutura.

Ver ADR: [`adr/001-monolito-modular.md`](adr/001-monolito-modular.md)

---

## Stack Tecnológico

| Camada | Tecnologia | Motivo |
|---|---|---|
| Backend | NestJS + TypeScript | Framework estruturado, DI nativo, guards, pipes |
| ORM | Prisma | Type-safe, migrations versionadas, DX excelente |
| Banco | PostgreSQL | ACID, relacional, RLS nativo, suporte a transações complexas |
| Cache | Redis (Upstash) | Sessions, rate limiting, cache de catálogo |
| Frontend | Next.js (App Router) | SSR/SSG, layouts por papel, único app para todos |
| Pagamentos | Asaas | PIX nativo, webhook confiável, sem setup complexo |
| Email | Resend | API simples, free tier generoso |
| Infra | Railway + Vercel | Zero config, deploy por push, custo mínimo no início |

---

## Estrutura de Módulos (Backend)

```
apps/api/src/
├── modules/
│   ├── auth/           ← autenticação, sessões, JWT, refresh tokens
│   ├── school/         ← tenant, escola, cantina, configurações
│   ├── users/          ← usuários, perfis, papéis, vinculações
│   ├── catalog/        ← produtos, categorias, preços
│   ├── inventory/      ← estoque, reservas, movimentações
│   ├── orders/         ← pedidos, itens, status, histórico
│   ├── wallet/         ← carteira, saldo, transações (ledger)
│   ├── payments/       ← Asaas, webhooks, recargas PIX
│   ├── reports/        ← relatórios e dashboards (read-only)
│   └── notifications/  ← email de saldo baixo, confirmação
├── shared/
│   ├── database/       ← PrismaService, tenant middleware
│   ├── guards/         ← JwtAuthGuard, TenantGuard, RolesGuard
│   ├── decorators/     ← @CurrentUser, @TenantId, @Roles, @Public
│   ├── filters/        ← GlobalExceptionFilter
│   ├── pipes/          ← ValidationPipe config
│   ├── middleware/     ← TenantMiddleware, RequestLoggerMiddleware
│   └── types/          ← interfaces e enums internos do backend
└── main.ts
```

### Hierarquia de Dependências entre Módulos

```
auth        → shared
school      → auth, shared
users       → auth, school, shared
catalog     → school, shared
inventory   → catalog, school, shared
wallet      → school, users, shared
orders      → catalog, inventory, wallet, shared
payments    → wallet, shared
reports     → [todos, read-only]
notifications → [todos, read-only]
```

**Regra:** Nenhum módulo importa de um módulo "acima" dele nessa hierarquia.
`orders` pode importar `wallet`, mas `wallet` nunca importa `orders`.
Violações desta regra são consideradas bugs arquiteturais.

---

## Estrutura de Rotas (Frontend)

```
apps/web/src/app/
├── (auth)/
│   ├── login/
│   └── register/
├── (tenant)/
│   ├── admin/                ← SCHOOL_ADMIN
│   │   ├── dashboard/
│   │   ├── users/
│   │   ├── catalog/
│   │   ├── inventory/
│   │   └── reports/
│   ├── canteen/              ← CANTEEN_OP
│   │   ├── pdv/
│   │   ├── orders/
│   │   └── inventory/
│   ├── parent/               ← GUARDIAN
│   │   ├── dashboard/
│   │   ├── recharge/
│   │   └── history/
│   └── student/              ← STUDENT
│       ├── balance/
│       └── history/
└── layout.tsx
```

---

## Multi-Tenancy

**Modelo:** Shared Database, Row-Level Isolation.

Cada linha de dado pertencente a um tenant tem coluna `school_id`.
O isolamento opera em duas camadas:

**Regra canônica:** qualquer lookup em tabela de tenant com id vindo da request usa `findFirst` + `schoolId`. `findUnique`/`findUniqueOrThrow` não são o padrão nesses caminhos porque o middleware não injeta tenant em chave única.

**Camada 1: Prisma Middleware (aplicação)**
Injeta automaticamente `schoolId` em toda criação e filtro em toda leitura.
Rejeita qualquer query em tabela de tenant sem contexto ativo.

**Camada 2: PostgreSQL RLS (banco)**
Policies no banco garantem que mesmo uma query mal formada não atravessa tenants.
Fallback caso a camada de aplicação falhe.

**Rotas semi-públicas:** webhooks do Asaas são `@Public()` apenas no nível de guard; a autenticação real vem da assinatura HMAC. O tenant é resolvido depois da gravação do receipt em `payment_webhooks`, usando a cobrança localizada em `payment_requests`.

**Contexto por requisição:**
O `schoolId` é extraído do JWT, injetado no `AsyncLocalStorage` pelo middleware
e propagado para todas as operações de banco da requisição.

Ver ADR: [`adr/003-multitenancy.md`](adr/003-multitenancy.md)

---

## Autenticação

**Modelo:** JWT access token (15 min) + refresh token rotation (7 dias, HttpOnly cookie).

- Access token: curto prazo, armazenado em memória no frontend (nunca localStorage)
- Refresh token: longo prazo, cookie HttpOnly + Secure + SameSite=Strict
- Rotation: ao usar refresh token, ele é revogado e novo é emitido
- Invalidação explícita: `sessionId` no JWT permite revogar sessão no logout

Ver ADR: [`adr/002-auth-refresh-token.md`](adr/002-auth-refresh-token.md)

---

## Contrato de API

**Estilo:** REST com OpenAPI/Swagger
**Versão:** `/api/v1/` desde o início

**Envelope de resposta padrão:**

```typescript
// Sucesso
{ "data": T, "meta"?: { "page": number, "total": number } }

// Erro
{ "error": { "code": string, "message": string, "details"?: unknown } }
```

Nunca retorne array na raiz de uma resposta.
Nunca retorne estruturas diferentes para sucesso e erro.

---

## Estratégia de Escalabilidade

**Agora (Fase 0–1):** Railway + Vercel, banco único, sem cache agressivo, sem filas.

**Quando escalar (Fase 2, com receita):**

1. Mover para AWS ECS Fargate + RDS PostgreSQL Multi-AZ
2. Redis gerenciado via ElastiCache
3. S3 + CloudFront para assets
4. Implementar filas (SQS) apenas se processamento síncrono de webhook se tornar gargalo

**O que NÃO escalar prematuramente:**

- Não usar filas de mensagens antes de ter volume real
- Não separar microsserviços antes de ter motivo de negócio
- Não implementar CQRS antes de ter leitura/escrita com requisitos diferentes

---

## Decisões Arquiteturais Registradas (ADRs)

| ADR | Decisão |
|---|---|
| [001](adr/001-monolito-modular.md) | Monólito modular em vez de microsserviços |
| [002](adr/002-auth-refresh-token.md) | JWT + refresh token rotation com HttpOnly cookie |
| [003](adr/003-multitenancy.md) | Row-level isolation com Prisma middleware + RLS |
| [004](adr/004-ledger-carteira.md) | Ledger imutável para transações financeiras |
