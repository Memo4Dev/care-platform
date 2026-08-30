# ADR-0011: Authentication Audience Is Not the Platform/Tenant Authorization Boundary

Status: Accepted

## Context

Supabase user access tokens are minted by Supabase Auth for normal sign-in flows
and carry `aud=authenticated`. The API previously enforced
`assertSeparatedBearerAudiences()`, which required the Platform and Tenant
bearer audiences (`SUPABASE_PLATFORM_AUDIENCE` vs `SUPABASE_TENANT_AUDIENCE`) to
be distinct values and treated that separation as the boundary between Platform
and Tenant authorization.

That requirement conflicted with real Supabase sign-in: an online/tenant user's
access token carries the single `authenticated` audience, so it could never
satisfy a distinct tenant audience, and granting Platform principals elevated
access would have required a separate token issuer/flow for Platform principals
that does not exist in the current Supabase integration. The stale
distinct-audience configuration caused the staging API to fail closed at
bootstrap because the configured audiences did not match the runtime tokens.

The JWT `aud` claim identifies the token's intended **API audience only**. It
is not proof of Platform (or tenant) authorization. Authorization is a
server-side property of an identity, resolved from application persistence
after Supabase has verified the identity.

## Decision

- Authentication audience separation is **not** the Platform-vs-Tenant
  authorization boundary. `aud` selects which API surface a token was minted
  for (Platform admin vs tenant), nothing more.
- Platform vs Tenant separation is enforced **server-side after Supabase
  identity verification** by the principal resolvers and RBAC, per
  ADR-0004 (database-backed platform authorization) and ADR-0005 (trusted
  authenticated principal context):
  - Platform access: `DatabasePlatformPrincipalResolver` requires a `platform.principals`
    row for the verified subject with status `ACTIVE`.
  - Tenant access: `TenantBearerGuard` requires an `identity.users` row with
    status `ACTIVE` and a tenant with `provisioningStatus = COMPLETED` and
    status `ACTIVE`.
- A valid Supabase token alone **never** grants Platform (or tenant) access;
  only the verified subject plus a server-side assignment does.
- `assertSeparatedBearerAudiences()` is removed. A single Supabase
  `authenticated` audience is used for user identity; both guards verify the
  token with their configured expected audience and then resolve the subject
  against server-side state.
- Caller-injected JWT claims (`role`, `permission`/`capability`,
  `organizationId`, `organizationUserId`) are never authorization inputs. The
  verifier reads only `sub`, `iss`, `aud` and `exp`; resolvers rely only on the
  verified subject plus the database.

## Alternatives

- **Keep distinct Platform/Tenant audiences as the boundary and require a
  dedicated Platform token issuer/flow.** Rejected: no such issuer/flow exists;
  it would break normal Supabase sign-in for tenant users and add a parallel
  credential model without a home in Supabase Auth.
- **Treat audience separation as the authorization boundary (status quo
  ante).** Rejected: it conflates identity with authorization — any token
  carrying the expected audience would be trusted as a Platform principal
  without any server-side assignment, and real `aud=authenticated` tokens could
  not be verified at all.
- **Authorize from caller-supplied claims (e.g. `role=PLATFORM_OWNER`).**
  Rejected per ADR-0004/ADR-0005: forged role labels would be treated as
  static application input rather than server-owned authorization state.

## Consequences

- A single Supabase `authenticated` audience is used for user identity; the
  Platform/Tenant boundary is enforced server-side by
  `DatabasePlatformPrincipalResolver` (`platform.principals`) and
  `TenantBearerGuard` (`identity.users` + tenant lifecycle). A verified subject
  alone never grants Platform or tenant access.
- Token verification still validates signature, issuer, `exp` and that `aud`
  contains the expected audience before any subject resolution, so audience
  verification remains a real gate — it just is not the authorization boundary.
- Security tests now assert the boundary at the guard/resolver level: missing
  `platform.principals` rows deny Platform access for valid tokens, non-ACTIVE
  principal rows deny, cross-boundary tokens are denied on both sides, and
  injected claims are ignored.

## Security

- The verified subject is the only identity input to authorization; all
  authorization state is read from application persistence.
- Caller-injected `role`, `permission`/`capability`, `organizationId` and
  `organizationUserId` claims cannot bypass server-side authorization.
- Negative test coverage is explicit:
  - JWT verification: wrong issuer, wrong audience, expired token, tampered
    signature, unsigned/malformed/extra-segment tokens are rejected
    (`supabase-jwt.service.spec.ts`).
  - Boundary: valid JWT with no `platform.principals` row is denied; non-ACTIVE
    principal denied; organization user without a platform row denied on
    platform endpoints; platform user without tenant membership denied on
    tenant endpoints; injected claims denied
    (`auth-boundary.security.spec.ts`).
  - Tenant isolation and lifecycle denials remain covered by the HTTP
    integration matrix (cross-tenant 403/404, `TENANT_SUSPENDED`,
    `TENANT_PROVISIONING_INCOMPLETE`).

## Compatibility

- `SUPABASE_PLATFORM_AUDIENCE` and `SUPABASE_TENANT_AUDIENCE` remain supported
  environment configuration and **may be equal** (e.g. both `authenticated`).
- The verifier accepts a token whose `aud` includes the expected audience
  (single string or array membership); it no longer requires the Platform and
  Tenant audiences to be distinct.
- The change is backward compatible for tenants: real Supabase
  `aud=authenticated` user tokens now verify against either guard's expected
  audience instead of failing at bootstrap-time configuration checks.
