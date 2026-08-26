# ADR-0002: Organization-Scoped Identity Administration

Status: Accepted

## Context

Branch role grants must not accidentally authorize tenant-wide identity administration. Identity integration events also require the versioned, ID-first envelope in architecture 58.

## Decision

Identity administration uses explicit organization-scoped role grants. The capabilities are `users.manage`, `roles.manage`, `permissions.manage`, `role-grants.manage`, and `branch-access.manage`. Owner provisioning receives all catalog capabilities through an organization-scoped Owner grant; the Owner label is never an authorization bypass.

Role definition, permissions, and role grants require the corresponding organization-scoped capability. Branch access can be managed by organization-scoped `branch-access.manage`, or by the same capability at the target branch when that branch is in the actor's authorized scope.

After bootstrap, an active actor holding organization-scoped `role-grants.manage` may grant any organization role, including the Owner template, to another user. This is a normal authorized role grant, not a new bootstrap initial Owner. Self-assignment remains prohibited.

Actors cannot change their own organization/branch roles or access, alter a role assigned to them, or create then self-grant a role. Public user creation and identity-linking require organization-scoped `users.manage`. Trusted provisioning is one atomic `provisionInitialOwner` command on a dedicated provisioning-only provider exposed only through `IDENTITY_PROVISIONING`; it uses internal SYSTEM identity, idempotently resolves the exact supplied initial identity, creates or validates only the approved fixed templates, and grants the seeded Owner template only to that identity. Bootstrap operations are not methods of the general `IdentityService` and no API accepts an arbitrary existing user for the initial Owner grant.

Identity events use an ID-first version-1 envelope: stable lower-kebab `identity.entity-action` names, IDs/capability codes only, actor and correlation/causation fields. Profile PII is not emitted. The `identity.initial_owner_assignments` organization-primary-key claim is the durable concurrency authority for exactly one bootstrap initial Owner provisioning record; it does not make Owner a permanent singleton and does not limit normal role grants.

## Alternatives

- Treat Owner as a permanent bypass: rejected because it defeats revocation and auditability.
- Reuse branch grants for organization actions: rejected because missing branch scope must not union permissions.
- Put PII in event payloads: rejected because consumers do not need profile data to react to identity changes.

## Consequences

Provisioning must establish Owner authority before normal administration. Existing callers must supply an actor context. Organization-wide authorization is explicit and auditable; self-service escalation is denied. Tenant Provisioning callers must supply correlation and causation IDs for every provisioning command.
