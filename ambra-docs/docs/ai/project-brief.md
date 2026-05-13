# Project Brief — Contexto para IA

**Use este documento no início de cada sessão de trabalho.**
Ele fornece contexto suficiente para qualquer agente de IA trabalhar no projeto sem precisar ler toda a documentação.

---

## O Projeto

**Ambra** é um SaaS de gestão operacional e financeira para cantinas escolares.

**Problema:** Cantinas de escolas privadas operam com dinheiro físico, sem controle dos pais e sem visibilidade para a gestão.

**Solução:** Carteira digital pré-paga por aluno. Responsável recarrega via PIX. Operador usa PDV para registrar compras. Gestor vê relatório do dia.

**Mercado:** Escolas privadas pequenas e médias com 200–1.500 alunos.

---

## Stack Técnica

```
Backend:   NestJS + TypeScript + Prisma + PostgreSQL
Frontend:  Next.js (App Router) — UM único app para todos os papéis
Cache:     Redis (Upstash)
Pagamentos: Asaas (PIX)
Infra:     Railway (backend) + Vercel (frontend)
```

---

## Arquitetura

**Monólito modular.** Módulos com fronteiras claras, não microsserviços.

**Módulos do backend:**
`auth` → `school` → `users` → `catalog` → `inventory` → `wallet` → `orders` → `payments` → `reports`

Cada módulo só importa de módulos anteriores a ele nessa lista.

**Multi-tenancy:** Row-level isolation. Toda tabela de tenant tem `school_id`. Prisma middleware injeta automaticamente e RLS no PostgreSQL atua como segunda camada. Leituras por id vindas da request usam `findFirst` + `schoolId`; `findUnique`/`findUniqueOrThrow` não são o padrão para tabelas de tenant.

**Auth:** JWT access token (15min, memória) + refresh token rotation (7 dias, HttpOnly cookie).

---

## Papéis de Usuário

| Papel | Descrição |
|---|---|
| `SCHOOL_ADMIN` | Gestor — acesso total ao tenant |
| `CANTEEN_OP` | Operador de cantina — PDV e estoque |
| `GUARDIAN` | Responsável pelo aluno — recarga e extrato |
| `STUDENT` | Aluno — somente leitura |

---

## MVP — O que existe (MUST HAVE)

1. Cadastro de escola, cantina, usuários
2. Vinculação responsável ↔ aluno
3. Catálogo de produtos com estoque
4. Carteira digital por aluno
5. Recarga via PIX (Asaas) com webhook idempotente e semi-público (`@Public()` + HMAC + receipt-first em `payment_webhooks`)
6. PDV: criar pedido, debitar saldo, reservar estoque
7. Cancelamento com estorno e liberação de estoque
8. Histórico de transações
9. Relatório diário de vendas
10. Notificação de saldo baixo por email

**Estados canônicos de pedido no MVP:** `PENDING` (rascunho), `CONFIRMED` (saldo debitado + estoque reservado), `DELIVERED` (produto entregue) e `CANCELLED` (pedido cancelado). Não existe `READY` nem `PREPARING`.

**Consentimentos LGPD:** autorizações de uso de dados e consentimento de responsável para menores são registrados em `user_consents` e tratados como append-only.

---

## O que NÃO existe (congelado)

Nunca implemente sem aprovação explícita:

- App nativo (iOS/Android)
- IA nutricional
- Integração fiscal (NFC-e)
- B2G / escola pública
- Módulo de risco
- Cupons e descontos
- White-label
- Console global de admin
- Filas de mensagens (Bull, SQS, RabbitMQ)
- CQRS
- Event sourcing
- Múltiplos gateways de pagamento

---

## Invariantes de Dados (nunca viole)

- Saldo de carteira nunca negativo (constraint no banco)
- Estoque nunca negativo (constraint no banco)
- `wallet_transactions` é append-only — nunca UPDATE/DELETE
- `audit_logs` é append-only — nunca UPDATE/DELETE
- Toda operação de pedido (criar/cancelar) ocorre em `prisma.$transaction`
- Toda recarga tem `idempotency_key` — webhook duplicado não credita duas vezes
- `JWT_SECRET` é obrigatório; aplicação não inicia sem ele

---

## Padrões de Código Obrigatórios

```typescript
// ✓ Sempre tipado
async createOrder(dto: CreateOrderDto, ctx: TenantContext): Promise<OrderResponse>

// ✓ Transação para operações financeiras
await prisma.$transaction(async (tx) => { ... })

// ✓ Resposta padrão de API
{ data: T } | { error: { code: string, message: string } }

// ✗ Nunca
any, localStorage para tokens, query sem schoolId em tabela de tenant
```

---

## Segurança — Checklist de Qualquer Endpoint Novo

- [ ] Guard de autenticação está ativo (ou `@Public()` é explícito e justificado)?
- [ ] `@Roles()` está definido se a rota requer papel específico?
- [ ] Toda query em tabela de tenant filtra por `schoolId`?
- [ ] Input do usuário passa por `class-validator`?
- [ ] Dados sensíveis não aparecem em logs?

---

## Estrutura do Repositório

```
ambra/
├── apps/
│   ├── api/src/modules/   ← módulos do backend
│   └── web/src/app/       ← rotas do frontend por papel
├── packages/types/        ← DTOs e enums compartilhados
├── docs/                  ← documentação viva
│   ├── adr/               ← Architecture Decision Records
│   └── ai/                ← este arquivo e regras para IA
├── AGENTS.md              ← regras de trabalho com IA
└── .env.example
```

---

## Documentação Complementar

| Para entender | Leia |
|---|---|
| Problema e mercado | `docs/00-contexto-do-produto.md` |
| Escopo exato do MVP | `docs/01-mvp.md` |
| Arquitetura detalhada | `docs/02-arquitetura.md` |
| Schema do banco | `docs/03-modelo-de-dados.md` |
| Auth, RBAC, tenant | `docs/04-seguranca.md` |
| Fluxos passo a passo | `docs/05-fluxos-de-negocio.md` |
| Padrões de código | `docs/ai/coding-rules.md` |
| O que nunca fazer | `docs/ai/forbidden-patterns.md` |

---

## Estado Atual do Projeto

> **Atualize esta seção ao final de cada sprint.**

**Fase atual:** Planejamento — nenhum código implementado ainda.

**Próximo passo:** Criar estrutura do repositório + auth + tenant isolation + primeiros testes.

**Pendências bloqueantes:** Nenhuma.
