# ADR 001 — Monólito Modular em vez de Microsserviços

**Data:** 2025-05
**Status:** Aceito
**Autores:** Decisão de arquitetura inicial

---

## Contexto

O projeto Ambra precisa de uma arquitetura que:
- Seja operável por um único desenvolvedor
- Tenha custo de infraestrutura mínimo (zero até primeiro cliente)
- Permita evolução para separação de serviços se necessário
- Seja confiável e testável desde o início

---

## Decisão

**Adotar monólito modular com fronteiras de domínio explícitas.**

Microsserviços foram considerados e descartados.

---

## Justificativa

**Por que não microsserviços:**

| Requisito de microsserviços | Realidade do projeto |
|---|---|
| Time com múltiplas equipes independentes | Um desenvolvedor |
| Serviços com requisitos de escala distintos | Volume desconhecido, sem dados |
| Deploy independente de componentes | Overhead sem benefício |
| Isolamento de falhas entre domínios | Monólito modular oferece fronteiras suficientes |
| Infraestrutura distribuída gerenciada | Sem orçamento e sem equipe de ops |

**Por que monólito modular:**

- Sem overhead operacional: um processo, um deploy, um banco
- Testabilidade: testes de integração são simples (sem mocks de rede)
- Refatoração facilitada: mover código entre módulos é renomear pastas
- Observabilidade simples: um log, uma instância, um ponto de falha para monitorar
- Fronteiras explícitas: módulos com hierarquia de dependências definida
- Extração futura possível: quando houver motivo de negócio real, as fronteiras já existem

---

## Fronteiras de Módulo

A hierarquia de dependências é definida e imutável:

```
auth → school → users → catalog → inventory → wallet → orders → payments → reports
```

Nenhum módulo importa de um módulo à sua direita nessa hierarquia.
Violações são consideradas bugs arquiteturais, não diferenças de opinião.

---

## Consequências

**Positivas:**
- Deploy simples e confiável
- Testes de integração sem mocks complexos
- Custo operacional mínimo
- Onboarding rápido em novas sessões de IA

**Negativas / Trade-offs:**
- Escala horizontal limitada (todos os módulos escalam juntos)
- Uma falha pode afetar toda a aplicação (mitigado por boas práticas de error handling)
- Banco compartilhado (mitigado por RLS e Prisma middleware de tenant)

---

## Critério de Revisão

Esta decisão deve ser revisada quando:
- Houver volume real que exija escala independente de um módulo específico
- Um módulo tiver requisitos de tecnologia incompatíveis com o restante (ex: processamento intensivo de ML)
- O time crescer para 3+ desenvolvedores com responsabilidades distintas

Até lá, o monólito modular é a decisão correta.
