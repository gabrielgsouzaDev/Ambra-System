# ADR 003 — Row-Level Isolation com Prisma Middleware + RLS

**Data:** 2025-05
**Status:** Aceito

---

## Contexto

O Ambra é multi-tenant: múltiplas escolas compartilham a mesma instância da aplicação e do banco. O isolamento de dados entre escolas é requisito de segurança crítico — uma escola não pode ver dados de outra.

## Modelos Considerados

| Modelo | Isolamento | Custo | Complexidade |
|---|---|---|---|
| Banco separado por tenant | Máximo | Muito alto (inviável sem receita) | Alta |
| Schema separado por tenant | Alto | Médio | Média |
| Row-level isolation | Suficiente | Mínimo | Baixa |

## Decisão

**Row-level isolation em banco compartilhado com duas camadas de proteção:**

1. **Prisma Middleware** (camada de aplicação): injeta `schoolId` automaticamente em todas as queries
2. **PostgreSQL RLS** (camada de banco): policies que impedem queries sem contexto correto
3. **Padrão de lookup:** leituras por id vindas da request usam `findFirst`/`findFirstOrThrow` com `schoolId` explícito. `findUnique`/`findUniqueOrThrow` ficam restritos a tabelas globais ou a casos internos já completamente escopados.

## Implementação

### Prisma Middleware

```typescript
prisma.$use(async (params, next) => {
  const tenantId = getTenantFromAsyncLocalStorage();
  
  if (!tenantId && TENANT_TABLES.includes(params.model)) {
    throw new SecurityException(`Query on ${params.model} without tenant context`);
  }
  
  if (tenantId) {
    if (params.action === 'create') {
      params.args.data.schoolId = tenantId;
    }
    if (['findMany', 'findFirst', 'count'].includes(params.action)) {
      params.args.where = { ...params.args.where, schoolId: tenantId };
    }
  }
  
  return next(params);
});
```

### RLS PostgreSQL

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON orders
  USING (school_id = current_setting('app.current_school_id', true)::uuid);
```

### Tenant Context por Requisição

O `schoolId` viaja pelo ciclo de vida da requisição via `AsyncLocalStorage`:

```
JWT → TenantMiddleware → AsyncLocalStorage → Prisma Middleware → Query
```

## Testes Obrigatórios

Antes de qualquer deploy em produção:

```typescript
it('school A admin cannot read orders from school B')
it('school A operator cannot modify school B inventory')
it('query without tenant context throws SecurityException')
it('prisma middleware injects schoolId on create')
it('prisma middleware filters by schoolId on findMany')
```

## Limitações Conhecidas

- `findUnique` por ID não é filtrado pelo middleware (by design do Prisma). Não use esse padrão quando o id vier de input do usuário; prefira `findFirst`/`findFirstOrThrow` com `schoolId`.
- RLS com `current_setting` requer SET no início da transação quando em modo de conexão pooling.

## Critério de Revisão

Revisar para schema-per-tenant quando: volume justificar custo, compliance exigir isolamento mais forte, ou cliente enterprise requerer banco dedicado.
