---
name: supabase-auth
description: Supabase proves identity; application owns RBAC. JWT verification, trusted principal context, platform authorization.
---

# supabase-auth

## Instructions

Supabase proves identity; application owns RBAC.
Next SSR cookies, API bearer JWT, separate POS device credentials.

## JWT Verification Requirements

JWT verification must validate at minimum:
- signature (HS256, RS256, ES256)
- issuer (`iss`) — from server configuration, never from the token
- audience (`aud`) — from server configuration, never from the token
- expiration (`exp`)
- required subject/identity claims

Trusted issuer and audience come from environment configuration:
`SUPABASE_JWT_ISSUER`, `SUPABASE_PLATFORM_AUDIENCE`, `SUPABASE_TENANT_AUDIENCE`.

Never derive trusted issuer/audience from the incoming token.

Required negative tests:
- wrong issuer → rejected
- wrong audience → rejected
- expired token → rejected
- invalid signature → rejected
- missing/empty token → rejected
- malformed token (not 3 dot-separated parts) → rejected

## Authenticated Principal Boundary

Application services must not treat raw IDs as proof of authorization.
Do not authorize from caller-supplied:
- platformUserId
- organizationUserId
- role
- capability
- SYSTEM_SERVICE type

Use trusted `AuthenticatedPrincipal` contexts created by approved
server-side authentication/principal providers.

Supabase:
- authentication / identity proof

Application persistence:
- authorization / RBAC / scopes / capabilities

## Platform Authorization Source of Truth

Platform authorization is server-side persisted (database-backed).
Supabase JWT custom roles must NOT become the authorization source of truth.

Use an abstraction such as:
```
PlatformAuthorizationProvider
→ DatabasePlatformAuthorizationProvider
```

Platform roles/capabilities remain separate from tenant organization roles.
Caller-supplied PLATFORM_OWNER or equivalent must never be trusted.

## Tenant Lifecycle Guard

Tenant bearer authentication must verify linked PlatformTenant state:
- ACTIVE + COMPLETED → allowed
- SUSPENDED → TENANT_SUSPENDED
- CLOSED → TENANT_SUSPENDED
- PENDING/PROVISIONING_INCOMPLETE → TENANT_PROVISIONING_INCOMPLETE

## Provisioning Trust Boundary

Initial tenant Owner identity derives from trusted persisted
registration/signup state. Provisioning must not accept authoritative
caller-supplied tenantId, organizationId, ownerEmail, ownerName,
or owner subject for establishing the initial Owner.

Provisioning uses a dedicated opaque server-issued execution capability:
- scoped to one provisioning execution/tenant
- server-issued, non-public, narrow
- replay protected
- invalid after completion/terminal failure
- unusable for unrelated operations

## Always

- Read `AGENTS.md`.
- Use the architecture routing index.
- Do not silently change architecture.
- Run relevant quality gates.
- Never push/merge without human approval.
