# 01 — MVP: Escopo Exato

**Última atualização:** 12-05-2026
**Status:** Ativo — não altere sem registrar o motivo

---

## Critério de "Pronto para Pilotar"

O sistema está pronto para piloto quando, **sem erro**, em **três execuções consecutivas**
com **dois operadores simultâneos**:

1. Um responsável recarrega R$ 50,00 via PIX
2. O saldo aparece na carteira em menos de 30 segundos após o pagamento
3. Um operador cria e confirma um pedido de R$ 12,00 para um aluno
4. O saldo do aluno diminui corretamente (R$ 38,00)
5. O estoque do produto diminui corretamente
6. O gestor vê a venda no relatório do dia
7. Um segundo operador simultâneo não consegue vender item sem estoque

Se qualquer um desses pontos falhar, o sistema não está pronto.

---

## O que está DENTRO do MVP

### MUST HAVE — sem isso o produto não abre

| # | Feature | Módulo |
|---|---|---|
| 1 | Cadastro de escola e cantina | school |
| 2 | Cadastro de operador, gestor, responsável, aluno | users |
| 3 | Vinculação responsável ↔ aluno (1 responsável, múltiplos alunos) | users |
| 4 | Catálogo de produtos com nome, preço, foto e estoque | catalog |
| 5 | Categorias de produtos | catalog |
| 6 | Carteira digital por aluno com saldo | wallet |
| 7 | Recarga via PIX (geração de cobrança Asaas) | payments |
| 8 | Confirmação de pagamento via webhook (idempotente) | payments |
| 9 | PDV: buscar aluno, montar pedido, confirmar | orders |
| 10 | Débito automático do saldo na confirmação do pedido | wallet + orders |
| 11 | Reserva de estoque na criação + baixa na entrega | inventory + orders |
| 12 | Cancelamento de pedido com estorno e liberação de estoque | orders |
| 13 | Histórico de transações do aluno (responsável visualiza) | wallet |
| 14 | Relatório diário: vendas por produto (gestor) | reports |
| 15 | Notificação de saldo baixo por email | notifications |
| 16 | Login seguro com refresh token | auth |
| 17 | Isolamento completo entre escolas (multi-tenant) | auth + infra |

### SHOULD HAVE — entra se não atrasar 30 dias do cronograma

| # | Feature | Módulo |
|---|---|---|
| 18 | Limite de gasto diário por aluno (definido pelo responsável) | wallet |
| 19 | Bloqueio de categorias por aluno (responsável configura) | catalog |
| 20 | Extrato com filtro de data | wallet |
| 21 | Relatório de estoque (itens abaixo do mínimo) | inventory |
| 22 | Alerta de estoque mínimo por email | inventory |

---

## O que está FORA do MVP (congelado)

Esta lista é tão importante quanto a anterior.
Qualquer implementação de item desta lista requer decisão explícita e documentada.

### Congelado — não entra até validação de mercado

| Item | Motivo |
|---|---|
| Aplicativo nativo (iOS/Android) | PWA é suficiente para validar; app tem custo alto |
| IA nutricional / recomendações | Não resolve dor primária; nenhum piloto pediu |
| Integração fiscal (NFC-e, SAT, CF-e) | Requer homologação SEFAZ; só se o cliente exigir |
| B2G / escola pública / licitação | Ciclo longo, pagamento incerto, risco alto |
| Módulo de risco / Serasa / análise de crédito | Fora do escopo de cantina |
| Assinatura premium B2C (planos para pais) | Complexidade de cobrança sem demanda validada |
| Cupons e descontos sofisticados | Distrai da operação principal |
| White-label completo | Requer infraestrutura separada por cliente |
| Console global de super-admin | Administrar via banco no início é suficiente |
| Multi-cantina por escola | Maioria das escolas tem uma; validar primeiro |
| Offline industrial (PDV sem internet) | Protocolo complexo; internet 4G resolve |
| Relatórios avançados / BI | Excel exportado resolve no piloto |
| Pagamento por cartão no PDV (maquininha) | PIX pré-pago resolve o problema principal |
| Chat / mensagens responsável-escola | Fora do escopo; use WhatsApp |
| Cardápio semanal / planejamento nutricional | Feature de nutricionista, não de cantina |

---

## Fluxos Críticos do MVP

### Fluxo 1: Recarga de Carteira

```
Responsável acessa app web
→ Seleciona aluno
→ Informa valor (R$ 10,00 mínimo)
→ Sistema gera cobrança PIX via Asaas
→ Responsável paga o PIX
→ Asaas envia webhook para o sistema
→ Sistema valida assinatura do webhook
→ Sistema credita carteira (idempotente)
→ Responsável recebe email de confirmação
→ Saldo atualizado em tela
```

### Fluxo 2: Pedido no PDV

```
Operador abre PDV
→ Busca aluno (por nome ou código)
→ Adiciona produtos ao pedido
→ Sistema mostra saldo disponível e total
→ Sistema verifica: saldo suficiente? estoque disponível?
→ Operador confirma
→ Sistema reserva estoque + debita saldo (transação única)
→ Operador entrega o pedido
→ Sistema baixa estoque (reserva → consumo)
→ Pedido aparece no relatório do dia
```

### Fluxo 3: Cancelamento

```
Operador cancela pedido (enquanto PENDING ou CONFIRMED)
→ Se CONFIRMED, sistema estorna saldo e libera reserva de estoque
→ Se PENDING, encerra apenas o rascunho
→ Status do pedido vai para CANCELLED
→ Auditoria registra quem cancelou e quando
```

---

## Papéis de Usuário no MVP

| Papel | O que pode fazer |
|---|---|
| `SCHOOL_ADMIN` | Tudo: usuários, catálogo, relatórios, configurações |
| `CANTEEN_OP` | PDV, estoque, relatório de vendas do dia |
| `GUARDIAN` | Recarregar carteira, ver extrato do aluno, configurar limites |
| `STUDENT` | Ver saldo e histórico (somente leitura) |

---

## Decisões de Produto Tomadas

Estas decisões foram tomadas conscientemente e não devem ser revertidas sem análise:

1. **Carteira pré-paga, não pós-pago.** Elimina risco de inadimplência e simplifica o fluxo.
2. **Um plano de preço, sem níveis.** Facilita o processo de venda no piloto.
3. **PIX como único método de recarga.** Massificado no Brasil; zero custo de infraestrutura adicional.
4. **PWA, não app nativo.** Sem custo de publicação em loja; funciona em qualquer dispositivo.
5. **Email como única notificação.** Push notification requer app nativo ou service worker complexo.
6. **Asaas como único gateway.** Simples, tem PIX, tem webhook confiável. Trocar quando houver motivo.
7. **Estados canônicos de pedido fechados.** No MVP, pedido só usa `PENDING`, `CONFIRMED`, `DELIVERED` e `CANCELLED`. Não existe `READY` nem `PREPARING`.
