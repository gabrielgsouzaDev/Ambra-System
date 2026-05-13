# ADR 002 — JWT + Refresh Token Rotation com HttpOnly Cookie

**Data:** 2025-05
**Status:** Aceito

---

## Contexto

O sistema precisa de autenticação que:
- Seja segura para um SaaS com dados financeiros de menores
- Funcione com frontend Next.js + backend NestJS separados
- Não armazene tokens de forma vulnerável a XSS
- Suporte invalidação explícita de sessão (logout)

## Alternativas Consideradas

1. **JWT simples sem refresh** — token longo prazo em localStorage
2. **Session-based (cookie de sessão)** — estado no servidor (Redis)
3. **JWT access + refresh rotation com HttpOnly cookie** ← escolhido

## Decisão

JWT access token de curta duração + refresh token rotation em HttpOnly cookie.

## Implementação

**Access token:**
- Expiração: 15 minutos
- Armazenamento: memória JavaScript (variável de estado React)
- Contém: `{ sub, schoolId, role, sessionId }`
- Renovado automaticamente via refresh token antes de expirar

**Refresh token:**
- Expiração: 7 dias
- Armazenamento: cookie `HttpOnly` + `Secure` + `SameSite=Strict`
- Rotation: cada uso revoga o token atual e emite novo
- Blacklist: `sessionId` armazenado em Redis para invalidação explícita

**Por que não localStorage:**
- Vulnerável a XSS — qualquer script injetado pode roubar o token
- Dados financeiros de menores de idade não podem ter esse risco

**Por que não apenas session cookie:**
- Requer estado no servidor para cada validação
- Escala pior (precisa de Redis ou banco para lookup de sessão em toda requisição)
- JWT permite validação stateless na maioria dos requests

**Por que rotation:**
- Token roubado é detectado: se alguém usar o refresh token roubado, o usuário legítimo tenta usar o token inválido e é deslogado
- Limita o impacto de vazamento de refresh token

## Consequências

- Frontend nunca usa `localStorage` para tokens
- Backend tem endpoint `/auth/refresh` que implementa a rotation
- Redis é necessário para blacklist de sessionId
- Logout server-side: invalida sessionId no Redis

## Critério de Revisão

Revisar se: autenticação federada (SSO) for exigida por cliente, ou se o modelo SPA mudar significativamente.
