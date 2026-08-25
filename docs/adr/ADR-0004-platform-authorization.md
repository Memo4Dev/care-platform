# ADR-0004: Database-Backed Platform Authorization

Status: Accepted

## Context

Platform Management actions and support access are high-impact operator functions.
Caller-supplied role labels could be forged and incorrectly treated platform
roles as static application input rather than server-owned authorization state.

## Decision

Platform principals are global operator identities linked one-to-one to a
Supabase user ID. Platform roles, capabilities, role-capability assignments and
principal-role assignments are stored in the `platform` schema and are wholly
separate from tenant Identity & Access roles.

`DatabasePlatformAuthorizationProvider` is the server-side source of truth.
Platform commands accept only an authenticated platform principal context plus
correlation/causation IDs; they resolve the required capability in the database.
The capability catalog is `tenant.view`, `tenant.suspend`,
`subscription.change`, `entitlement.override`, `support.session`, and
`platform.audit`, per architecture-72.

Support access is bound to the requesting platform principal. A session requires
a reason and expiry, cannot be started, ended or asserted by another operator,
and has no tenant-user impersonation identity. Expiry is persisted as `EXPIRED`
with audit fields and a transactional `SupportAccessEnded` outbox event before
access is denied.

## Consequences

Platform admin authentication must map its verified Supabase identity to an
active platform principal before invoking application commands. A future tenant
access adapter calls `assertOperatorBoundActiveSupportSession`; it must not
accept a session ID alone. Provisioning completion remains reserved to the
dedicated provisioning contract, not registration input or platform roles.
