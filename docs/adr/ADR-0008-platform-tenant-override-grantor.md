# ADR-0008: Platform Actor Attribution for Tenant Entitlement Overrides

Status: Accepted

## Context

`POST /api/v1/platform/tenants/{tenantId}/entitlement-overrides` is a Platform
Admin endpoint (`docs/architecture/53a-platform-admin-api.md`). It must be
authorized by a `PLATFORM_USER` with the `entitlement.override` capability
(`docs/architecture/70-security-architecture.md` and
`docs/architecture/72-authorization-matrix.md`). Platform principals are
deliberately separate from tenant Identity users (ADR-0004).

The current `entitlements.tenant_overrides.granted_by` column instead has a
mandatory composite foreign key to `(identity.users.id,
identity.users.organization_id)`. Consequently, a valid platform principal
cannot be recorded as the grantor. Supplying a tenant user ID from the request,
selecting an arbitrary tenant owner, or creating a tenant user for the operator
would forge attribution and violate the principal separation and tenant
isolation rules.

## Decision

Tenant overrides record generic `actor_type` and `actor_id` fields plus the
request correlation ID. `PLATFORM_USER` is valid only when `actor_id` resolves
to an active persisted `platform.principals` row. `SYSTEM_SERVICE` is reserved
for opaque server-issued `SYSTEM:*` identities. Organization users are not
valid override grantors.

## Consequences

M1-009 exposes the mutation only through authenticated Platform Admin routes.
Migration `0018` is additive: it retains the legacy tenant-user column for
historic rows, makes it nullable for new rows, and enforces actor validity with
a trigger. Reads expose the approved actor representation and never infer a
tenant user from a platform token.
