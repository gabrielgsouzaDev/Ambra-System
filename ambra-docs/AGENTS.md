# AGENTS.md — Regras de Trabalho com IA

Este arquivo define como qualquer agente de IA deve trabalhar neste repositório.
Leia antes de iniciar qualquer sessão de código ou arquitetura.

---

## Contexto do Projeto

**Ambra** é um SaaS de gestão operacional e financeira para cantinas escolares.
É desenvolvido por um único desenvolvedor usando IA como acelerador de execução.

**Leia obrigatoriamente antes de qualquer sessão:**

- [`docs/ai/project-brief.md`](docs/ai/project-brief.md) — contexto compacto do produto
- [`docs/01-mvp.md`](docs/01-mvp.md) — o que está dentro e fora do escopo
- [`docs/ai/forbidden-patterns.md`](docs/ai/forbidden-patterns.md) — o que nunca fazer
- [`docs/ai/coding-rules.md`](docs/ai/coding-rules.md) — padrões obrigatórios de código

---

## Regras Gerais

### 1. Siga a arquitetura existente, não proponha a sua

A arquitetura está documentada em `docs/02-arquitetura.md` e nos ADRs em `docs/adr/`.
Se uma decisão arquitetural precisar mudar, proponha explicitamente antes de implementar.
Nunca implemente uma mudança arquitetural silenciosamente.

### 2. Não implemente o que não está no MVP

O escopo está definido em `docs/01-mvp.md`.
Se uma feature não estiver listada como MUST HAVE ou SHOULD HAVE, não implemente.
Se você (IA) achar que algo faria sentido adicionar, mencione como sugestão — não como código.

### 3. Nunca quebre invariantes de dados

Os invariantes estão em `docs/03-modelo-de-dados.md`.
Saldo de carteira nunca pode ser negativo.
Estoque nunca pode ser negativo.
Transações financeiras são imutáveis (append-only).
Toda operação de pedido ocorre dentro de uma transação Prisma.

### 4. Segurança não é opcional

- Todo endpoint precisa de autenticação, a menos que `@Public()` seja explícito e justificado.
- Todo dado de tenant precisa filtrar por `schoolId`.
- Nunca armazene token em localStorage.
- Nunca logue dados sensíveis (email, CPF, valor de carteira em contexto de erro).

### 5. Consulte o protótipo apenas como referência de domínio

O repositório `ambra-legacy` pode ser consultado para entender nomes de domínio, fluxos
e decisões passadas. Nunca copie código de lá diretamente.

---

## Regras de Código

### TypeScript

```typescript
// ✓ Sempre tipado explicitamente
async createOrder(dto: CreateOrderDto, ctx: TenantContext): Promise<OrderResponse>

// ✗ Nunca any em código de produção
async createOrder(dto: any, ctx: any): Promise<any>
```

### Módulos NestJS

- Cada módulo tem sua própria pasta em `apps/api/src/modules/`
- Módulos só importam de módulos "abaixo" deles na hierarquia (ver `docs/02-arquitetura.md`)
- Nunca importe internals de outro módulo — apenas a interface pública (service exportado)

### Banco de Dados

```typescript
// ✓ Toda operação de pedido em transação
await prisma.$transaction(async (tx) => {
  await tx.walletTransaction.create(...)
  await tx.inventoryMove.create(...)
  await tx.order.update(...)
})

// ✗ Nunca operações financeiras fora de transação
await prisma.walletTransaction.create(...)
await prisma.inventoryMove.create(...)  // ← pode falhar e deixar inconsistência
```

### Erros

```typescript
// ✓ Erros com código identificável
throw new BusinessException('INSUFFICIENT_BALANCE', 'Saldo insuficiente para o pedido')

// ✗ Erros genéricos sem contexto
throw new Error('algo deu errado')
```

---

## O que Nunca Fazer

Ver lista completa em [`docs/ai/forbidden-patterns.md`](docs/ai/forbidden-patterns.md).

Resumo dos mais críticos:

- **Não use localStorage para tokens**
- **Não faça query sem filtro de schoolId em tabelas de tenant**
- **Não implemente feature fora do MVP sem aprovação explícita**
- **Não crie abstração genérica antes de ter dois casos de uso concretos**
- **Não use `any` em código de produção**
- **Não escreva diretamente no campo `balance` da carteira — use transações**
- **Não faça UPDATE ou DELETE em `wallet_transactions` ou `audit_logs`**

---

## Fluxo de Trabalho Recomendado

Para cada sessão de implementação:

1. Leia o `project-brief.md` para reconstruir contexto
2. Identifique qual módulo e qual camada está sendo trabalhada
3. Verifique se a feature está no MVP antes de começar
4. Implemente seguindo os padrões de `coding-rules.md`
5. Escreva testes antes ou junto ao código (não depois)
6. Se criou algo novo relevante, atualize o documento correspondente em `docs/`

---

## Atualizações de Documentação

Sempre que uma decisão arquitetural mudar, crie um ADR em `docs/adr/`.
Sempre que o escopo do MVP mudar, atualize `docs/01-mvp.md` e o motivo da mudança.
`docs/ai/current-state.md` deve ser atualizado ao final de cada sprint.
