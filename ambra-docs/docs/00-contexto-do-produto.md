# 00 — Contexto do Produto

**Última atualização:** 12-05-2026
**Status:** Ativo

---

## O Problema Real

Cantinas de escolas privadas pequenas e médias operam de forma caótica:

- Alunos chegam com dinheiro físico no recreio → fila, troco, perda de dinheiro
- Pais não sabem o que o filho comprou nem quanto gastou
- Operadores da cantina não sabem quantos itens preparar
- Gestão da escola não tem visibilidade do volume operacional
- Cantinas terceirizadas não têm como reportar dados para a escola

O resultado: recreio lento, reclamações de pais, operação manual e sem dados.

---

## A Solução

Carteira digital pré-paga por aluno com recarga via PIX, PDV operacional para a cantina e visibilidade para pais e gestão. O aluno não carrega dinheiro. O responsável recarrega pelo celular. O operador registra a compra em segundos. O gestor vê o que aconteceu.

Simples. Confiável. Sem papel.

---

## Mercado Alvo

### Quem compra primeiro (ICP)

**Escola privada pequena/média com cantina própria ou terceirizada.**

Características:
- 200–1.500 alunos
- Cantina como ponto de convivência central
- Gestão receptiva a tecnologia (já usa sistemas de secretaria)
- Decisão de compra pelo diretor ou coordenador administrativo
- Orçamento disponível para ferramentas operacionais (R$ 100–500/mês)

### Quem NÃO é o alvo inicial

- Escola pública (B2G: processo licitatório, ciclo longo, pagamento incerto)
- Rede nacional de franquias (requer customização profunda)
- Creches e educação infantil pura (dinâmica diferente)
- Cantinas universitárias (volume e complexidade diferentes)

---

## Proposta de Valor

**Para o gestor da escola:**
> "Sabe exatamente o que a cantina vendeu, sem precisar perguntar."

**Para o operador da cantina:**
> "Atende o aluno em 10 segundos, sem troco, sem fila."

**Para o responsável:**
> "Recarrega pelo celular e sabe o que o filho comeu."

**Para o aluno:**
> "Chega, pede, vai brincar."

---

## Diferencial Competitivo

O mercado de cantina escolar tem soluções antigas, complexas ou caras demais para escolas pequenas. O Ambra resolve o problema central (PDV + carteira + recarga PIX) de forma simples, com preço acessível e implantação rápida.

**Não tentamos ser:**
- Sistema de gestão escolar (SGE) — já existe, não compete
- Fintech para menores — requer regulação pesada
- ERP de cantina com fiscal — custo de implementação alto

**Somos:** a camada operacional financeira da cantina, integrada com a escola.

---

## Modelo de Negócio

**Fase de piloto:** gratuito (30 dias, 3–5 escolas parceiras)

**Pós-piloto:**
- R$ 149/mês por escola (plano único, todas as features do MVP)
- Taxa de implantação opcional: R$ 500 (configuração + treinamento presencial ou remoto)
- Sem cobrança por volume de transações, sem planos diferentes

**Expansão futura (não agora):**
- Planos por tamanho de escola
- Taxa por recarga para escala maior

---

## Histórico e Aprendizados do Protótipo

O repositório `ambra-legacy` foi um protótipo experimental que comprovou o problema
mas gerou dívida técnica séria:

- Excesso de features sem validação de mercado (IA, B2G, risk, fiscal)
- Autenticação e RBAC com falhas de segurança
- Multi-tenancy baseado em lógica de aplicação sem garantias no banco
- Múltiplos frontends com contratos divergentes
- Segredos versionados no repositório

**O que o protótipo provou:**
- O domínio está bem entendido (escola, cantina, carteira, responsável, aluno)
- Asaas é um gateway viável para PIX escolar
- A modelagem conceitual (pedido, produto, estoque, transação) é correta

**O que o protótipo NÃO provou:**
- Que qualquer escola pagaria pelo produto
- Que o sistema aguenta operação real sob carga
- Que os fluxos financeiros são confiáveis

---

## Métricas de Sucesso do Piloto

Ao final de 30 dias de piloto com 3–5 escolas:

| Métrica | Meta mínima |
|---|---|
| Recargas PIX processadas sem erro | > 95% |
| Tempo médio de atendimento no PDV | < 15 segundos |
| Pedidos criados sem falha de estoque | > 99% |
| Responsáveis que recarregaram pelo menos 1x | > 60% dos cadastrados |
| Tickets de suporte críticos (dados, pagamento) | 0 |
| Escolas dispostas a pagar após piloto | ≥ 2 |
