# 05 — Fluxos de Negócio

**Última atualização:** 12-05-2026
**Status:** Ativo

---

## Fluxos Críticos do MVP

### Fluxo 1: Recarga de Carteira via PIX

**Atores:** Responsável, Asaas (externo), Sistema

```
1. Responsável acessa /parent/recharge
2. Seleciona o aluno a recarregar
3. Informa o valor (mínimo R$ 10,00)
4. Sistema gera idempotency_key = hash(walletId + amount + timestamp)
5. Sistema cria payment_request com status PENDING
6. Sistema chama Asaas API: POST /payments com tipo PIX
7. Asaas retorna external_id + pix_code + pix_qr_url
8. Sistema salva dados na payment_request
9. Sistema exibe QR Code e código copia-e-cola para o responsável
10. Responsável realiza o pagamento no app do banco

--- FLUXO ASSÍNCRONO (webhook) ---

11. Asaas envia webhook PAYMENT_RECEIVED para /api/v1/payments/webhook/asaas
12. Sistema valida assinatura HMAC do webhook
13. Sistema grava o receipt em payment_webhooks como primeiro passo atômico, usando o id de entrega/evento do provedor
14. Se o receipt já existir, o sistema consulta processing_result: SUCCESS/IGNORED viram no-op; ERROR/NULL reprocessa o mesmo receipt sem criar outro crédito
15. Sistema localiza payment_request pela cobrança do Asaas (payment_requests.external_id) e extrai school_id
16. Sistema executa em transação:
    a. Cria wallet_transaction tipo CREDIT com balance_after calculado
    b. Atualiza wallet.balance via trigger
    c. Atualiza payment_request.status = PAID + paid_at
    d. Grava em audit_logs
17. Sistema envia email de confirmação para o responsável somente na primeira transição para PAID
18. Sistema atualiza payment_webhooks.processed_at e processing_result
19. Webhook responde 200 assim que o receipt estiver registrado; falhas posteriores não mudam o status HTTP
20. Responsável vê saldo atualizado na próxima abertura da tela
```

**Estados da payment_request:**
```
PENDING → PAID (webhook confirmação)
PENDING → EXPIRED (expirou sem pagamento)
PENDING → CANCELLED (cancelado manualmente)
```

**O que pode dar errado e como tratar:**
- Webhook duplicado → receipt único impede crédito duplo, responde 200
- Webhook antes de salvar payment_request → receipt fica registrado e o evento permanece disponível para retry seguro
- Asaas indisponível ao gerar cobrança → retorna erro ao usuário, não cria payment_request

---

### Fluxo 2: Pedido no PDV

**Atores:** Operador, Sistema

```
1. Operador abre /canteen/pdv
2. Operador busca aluno por nome ou código de matrícula
3. Sistema exibe foto, nome, saldo disponível e limite diário restante
4. Operador adiciona produtos ao pedido rascunho (status PENDING)
5. Sistema atualiza total e verifica em tempo real:
   - Saldo suficiente?
   - Estoque disponível por item?
   - Limite diário do aluno não excedido?
6. Se qualquer verificação falhar, botão de confirmar fica desativado; essas verificações são apenas UX e o service repete tudo dentro da transação.
7. Operador confirma o pedido

--- TRANSAÇÃO ÚNICA NO BANCO ---

8. Sistema executa em prisma.$transaction:
   a. Recarrega o pedido e seus itens no tenant e bloqueia os registros necessários
   b. Revalida saldo antes de qualquer mutation
   c. Revalida estoque de cada item antes de qualquer mutation
   d. Cria inventory_move tipo RESERVE para cada item
   e. Cria wallet_transaction tipo DEBIT
   f. Atualiza order.status = CONFIRMED e confirmed_by
   g. Cria order_status_history
   h. Grava em audit_logs

--- FIM DA TRANSAÇÃO ---

9. Sistema exibe confirmação com número do pedido
10. Operador entrega os itens ao aluno
11. Operador marca pedido como DELIVERED
12. Sistema cria inventory_move tipo OUT (reserva vira baixa real)
```

**Estados do pedido:**
```
PENDING → CONFIRMED (saldo debitado, estoque reservado)
CONFIRMED → DELIVERED (estoque baixado definitivamente)
PENDING → CANCELLED (encerra o rascunho)
CONFIRMED → CANCELLED (estorno + liberação de estoque)
```

No MVP, `PENDING` é o rascunho persistido no PDV. `CONFIRMED` é a confirmação financeira e de estoque. `DELIVERED` é a entrega física. Não existe `READY` nem `PREPARING`.

**Invariantes verificadas antes de confirmar:**
- `wallet.balance >= order.total_amount`
- Para cada item: `inventory_item.quantity >= item.quantity`
- Limite diário: soma de débitos do dia + total do pedido ≤ limite configurado

---

### Fluxo 3: Cancelamento de Pedido

**Atores:** Operador ou SCHOOL_ADMIN, Sistema

```
1. Operador acessa pedido com status PENDING ou CONFIRMED
2. Operador clica em cancelar e informa motivo (obrigatório)
3. Sistema executa em prisma.$transaction:
   a. Verifica que status é PENDING ou CONFIRMED (DELIVERED não cancela)
   b. Se status = CONFIRMED, cria wallet_transaction tipo CREDIT (estorno)
   c. Se status = CONFIRMED, cria inventory_move tipo RELEASE para cada item reservado
   d. Se status = PENDING, não há estorno nem release porque ainda é rascunho
   e. Atualiza order.status = CANCELLED
   f. Cria order_status_history com motivo
   g. Grava em audit_logs com quem cancelou

4. Sistema exibe confirmação
5. Responsável recebe email de notificação do cancelamento quando houver estorno (opcional)
```

**Regras de cancelamento:**
- Pedido DELIVERED: não pode ser cancelado pela interface (requer ajuste manual)
- Cancelamento parcial: não existe no MVP (cancela o pedido inteiro)
- Prazo: sem prazo — operador pode cancelar a qualquer momento antes da entrega
- Cancelamento de PENDING encerra o rascunho sem estorno nem liberação de estoque

---

### Fluxo 4: Onboarding de Nova Escola

**Atores:** SUPER_ADMIN (você), Gestor da escola

```
1. Você cria a escola via painel admin (ou script de seed)
2. Sistema cria: school + canteen + usuário SCHOOL_ADMIN inicial
3. Gestor recebe email com link de ativação de senha
4. Gestor acessa painel, ativa conta e configura:
   - Nome da escola, logo
   - Configura cantina
5. Gestor cadastra operadores de cantina
6. Gestor cadastra responsáveis e vincula alunos
   (ou importa via CSV — SHOULD HAVE)
7. Gestor cadastra produtos e estoque inicial
8. Sistema está pronto para operação
```

---

### Fluxo 5: Alerta de Saldo Baixo

**Trigger:** Qualquer débito na carteira de um aluno

```
1. wallet_transaction DEBIT é criada
2. Sistema verifica: novo saldo < threshold (R$ 10,00 padrão)
3. Se saldo baixo:
   a. Busca responsáveis vinculados ao aluno
   b. Envia email para cada responsável com:
      - Nome do aluno
      - Saldo atual
      - Link direto para recarga
4. Não envia novamente dentro de 24h para a mesma carteira
   (flag last_low_balance_alert em wallets)
```

---

## Regras de Negócio Transversais

### Saldo e Limite

- Saldo nunca vai abaixo de zero (constraint no banco)
- Limite diário: soma de todos os débitos do dia corrente + pedido atual ≤ limite configurado
- Limite NULL = sem limite
- Limite se aplica apenas a compras via PDV, não a ajustes manuais pelo gestor

### Estoque

- Disponibilidade = `quantity` total (estoque já é o disponível líquido de reservas via trigger)
- Produto inativo não aparece no PDV
- Produto com estoque zero aparece como "esgotado" (visível, não comprável)
- Estoque abaixo do `min_quantity` gera alerta (SHOULD HAVE)

### Preços

- O preço salvo em `order_items.unit_price` é um snapshot do momento da compra
- Mudança de preço de produto não afeta pedidos já criados
- Preço zero é permitido (produto gratuito)

### Pedidos

- Um pedido pertence a um aluno e a um operador
- Um operador pode ter múltiplos pedidos abertos simultaneamente (PDV para fila)
- Pedido sem itens não pode ser confirmado
- Pedido com item sem estoque não pode ser confirmado
