---
name: http-boundary-testing
description: Real NestJS/Fastify pipeline tests using app.inject covering auth through persistence for every HTTP endpoint.
---

# http-boundary-testing

## Instructions

Any task that creates or materially modifies HTTP endpoints must include
real NestJS/Fastify boundary tests using `app.inject()` or equivalent.

Controller/service unit tests alone do not satisfy this gate.

## Required Pipeline Coverage

Every protected endpoint test must exercise the actual pipeline:

```
HTTP request
→ authentication (JWT verification)
→ principal resolution (AuthenticatedPrincipal)
→ authorization (RBAC / capability check)
→ validation (Zod / DTO)
→ controller
→ application service
→ persistence where applicable
→ response/error envelope
```

## Test Matrix

Depending on endpoint behavior, coverage must include:

- valid authentication → success path
- missing authentication → 401
- invalid JWT signature → 401
- expired JWT → 401
- wrong JWT audience → 401
- wrong JWT issuer → 401
- suspended/disabled principal → appropriate error
- missing required capability → 403
- tenant isolation: cross-tenant organization IDOR → 404 (masked)
- tenant isolation: cross-tenant branch injection → 404 (masked)
- branch-scope enforcement: unauthorized branch → 404
- warehouse-scope enforcement: unauthorized warehouse → 404
- invalid body → Zod validation error envelope
- invalid params → validation error
- invalid pagination cursor → validation error
- idempotency: first call → expected status
- idempotency: same-key replay → same outcome
- idempotency: conflicting payload → IDEMPOTENCY_CONFLICT
- representative success path with response shape assertion

Not every endpoint requires all items. Select the applicable subset
based on the endpoint's auth requirements, mutation behavior, and scope.

## Response Envelope

Assert the error/success envelope shape matches the project standard:
- success: `{ data: T, meta?: { correlationId, pagination } }`
- error: `{ error: { code, message, details?, correlationId } }`

## Environment

Tests use `app.inject()` which does not require a running HTTP server.
Database tests use the native PostgreSQL test harness (`TEST_DATABASE_URL`).
Redis-dependent tests are CI-gated and skipped locally when unavailable.

## Always

- Read `AGENTS.md`.
- Use the architecture routing index.
- Do not silently change architecture.
- Run relevant quality gates.
- Never push/merge without human approval.
