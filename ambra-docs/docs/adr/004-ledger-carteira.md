# ADR 004 — Ledger Imutável para Transações Financeiras

**Data:** 2025-05
**Status:** Aceito

---

## Contexto

A carteira digital do aluno é o coração financeiro do produto. Toda recarga, compra, estorno e ajuste afeta o saldo. Precisamos de um modelo que:

- Garanta histórico completo e auditável
- Seja resistente a bugs de concorrência
- Permita recalcular o saldo a partir do zero se necessário
- Impossibilite fraude ou manipulação silenciosa de saldo

## Alternativas Consideradas

1. **Mutable balance** — campo `balance` atualizado diretamente em cada operação
2. **Event sourcing completo** — eventos imutáveis, saldo calculado on-the-fly
3. **Ledger com snapshot** — transações imutáveis + campo de saldo calculado ← escolhido

## Decisão

**Tabela `wallet_transactions` append-only com campo `balance` atualizado via trigger.**

## Implementação

```sql
wallet_transactions (imutável — nunca UPDATE ou DELETE)
  id               UUID
  wallet_id        UUID
  type             CREDIT | DEBIT
  amount           DECIMAL(10,2) — sempre positivo
  balance_after    DECIMAL(10,2) — snapshot do saldo após a operação
  source           ORDER | RECHARGE | REFUND | ADJUSTMENT
  reference_id     UUID — orderId ou paymentRequestId
  idempotency_key  VARCHAR — UNIQUE, previne duplicatas
  created_at       TIMESTAMPTZ
```

O campo `balance` em `wallets` é atualizado automaticamente via trigger a cada INSERT em `wallet_transactions`. Nunca é escrito diretamente pela aplicação.

**Trigger de recálculo:**
```sql
CREATE OR REPLACE FUNCTION sync_wallet_balance()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE wallets SET 
    balance = (
      SELECT COALESCE(SUM(
        CASE WHEN type = 'CREDIT' THEN amount ELSE -amount END
      ), 0)
      FROM wallet_transactions
      WHERE wallet_id = NEW.wallet_id
    ),
    updated_at = NOW()
  WHERE id = NEW.wallet_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER after_wallet_transaction_insert
  AFTER INSERT ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION sync_wallet_balance();
```

**Idempotência:**
```sql
CREATE UNIQUE INDEX idx_wallet_txn_idempotency 
  ON wallet_transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

Webhook duplicado do Asaas → tentativa de inserir com mesma `idempotency_key` → banco rejeita com erro de constraint → aplicação captura e responde 200 (ignorado silenciosamente).

## Propriedades Garantidas

1. **Auditoria completa:** todo centavo tem origem rastreável
2. **Recálculo possível:** `SELECT SUM` das transações deve sempre bater com `balance`
3. **Sem duplicata:** `idempotency_key` único impede crédito duplo de webhook
4. **Sem saldo negativo:** constraint `CHECK (balance >= 0)` na tabela `wallets`
5. **Imutabilidade:** sem UPDATE/DELETE, auditoria é confiável

## Consequências

- **Positivo:** histórico financeiro é fonte de verdade independente
- **Positivo:** bugs de concorrência afetam no máximo uma transação, nunca o histórico
- **Negativo:** tabela cresce indefinidamente (mitigado: linha por transação, não por tick de tempo)
- **Negativo:** trigger adiciona overhead mínimo por INSERT (aceitável para volume de cantina escolar)

## Critério de Revisão

Esta decisão é permanente enquanto o produto tiver componente financeiro.
O modelo pode ser estendido (ex: adicionar `metadata JSONB`) mas nunca tornado mutável.
