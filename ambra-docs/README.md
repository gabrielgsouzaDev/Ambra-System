# Ambra

Sistema de gestão operacional e financeira para cantinas escolares.

> **Repositório de produção.** O repositório anterior (`ambra-legacy`) existe apenas como arquivo de aprendizado. Nenhum código deste repo veio de lá.

---

## O Problema

Cantinas de escolas privadas operam com dinheiro físico, filas longas no recreio, sem controle dos pais sobre o que o filho compra e sem visibilidade operacional para a gestão. Isso é resolvível com software simples e confiável.

## O Produto

Carteira digital pré-paga por aluno. Recarga via PIX pelo responsável. PDV para o operador de cantina. Controle parental básico. Relatório diário para o gestor. Nada mais no MVP.

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | NestJS + TypeScript + Prisma |
| Frontend | Next.js (App Router) |
| Banco | PostgreSQL |
| Cache | Redis (Upstash) |
| Pagamentos | Asaas (PIX) |
| Infra | Railway (backend) + Vercel (frontend) |

## Setup Local

### Pré-requisitos

- Node.js 20+
- Docker (para PostgreSQL e Redis locais)

### Instalação

```bash
git clone https://github.com/seu-usuario/ambra
cd ambra
cp .env.example .env.local
# Edite .env.local com suas variáveis
docker compose up -d        # sobe postgres + redis
npm install
npm run db:migrate          # aplica migrations
npm run db:seed             # dados iniciais (desenvolvimento)
npm run dev                 # roda api + web em paralelo
```

### Verificação

```bash
curl http://localhost:3001/health
# { "status": "ok", "db": "connected", "redis": "connected" }
```

## Estrutura do Repositório

```
ambra/
├── apps/
│   ├── api/              ← NestJS backend (porta 3001)
│   └── web/              ← Next.js frontend (porta 3000)
├── packages/
│   └── types/            ← DTOs e enums compartilhados
├── docs/                 ← Documentação viva do projeto
│   ├── adr/              ← Architecture Decision Records
│   └── ai/               ← Contexto e regras para IA
├── docker-compose.yml
├── .env.example
├── AGENTS.md             ← Regras de trabalho com IA
└── turbo.json
```

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/00-contexto-do-produto.md](docs/00-contexto-do-produto.md) | Problema, mercado, proposta de valor |
| [docs/01-mvp.md](docs/01-mvp.md) | Escopo exato do MVP, o que está fora |
| [docs/02-arquitetura.md](docs/02-arquitetura.md) | Decisões arquiteturais e estrutura |
| [docs/03-modelo-de-dados.md](docs/03-modelo-de-dados.md) | Schema, relações, invariantes |
| [docs/04-seguranca.md](docs/04-seguranca.md) | Auth, RBAC, tenant isolation |
| [docs/05-fluxos-de-negocio.md](docs/05-fluxos-de-negocio.md) | Fluxos críticos passo a passo |
| [docs/ai/project-brief.md](docs/ai/project-brief.md) | **Leia antes de qualquer sessão com IA** |

## Comandos Úteis

```bash
npm run dev           # desenvolvimento
npm run build         # build de produção
npm run test          # todos os testes
npm run test:unit     # só testes unitários
npm run test:e2e      # testes end-to-end
npm run lint          # linting
npm run type-check    # verificação de tipos
npm run db:migrate    # aplica migrations
npm run db:studio     # Prisma Studio (visualizar banco)
```

## Status

| Fase | Status |
|---|---|
| Fundação (auth, tenant, CI) | 🔲 Em andamento |
| Core de domínio (escola, usuários, catálogo) | 🔲 Pendente |
| Core financeiro (carteira, estoque, pedidos) | 🔲 Pendente |
| Pagamentos (PIX via Asaas) | 🔲 Pendente |
| Interface (PDV, responsável, gestor) | 🔲 Pendente |
| Piloto (3–5 escolas) | 🔲 Pendente |
