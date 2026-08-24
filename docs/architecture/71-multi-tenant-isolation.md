# Multi-Tenant Isolation

Tenant isolation is a critical invariant.

## Rule

No request from Organization A may read or mutate Organization B business data.

## Defense in Depth

### Layer 1 — Authenticated tenant context

Server resolves:

```text
organizationId
actor
branch scope
permissions
```

from authenticated context.

### Layer 2 — Application repositories

Repository signatures must require tenant scope:

```text
findSale(organizationId, saleId)
findCustomer(organizationId, customerId)
```

Never use unscoped production repositories.

### Layer 3 — Composite tenant constraints

High-risk tables should use composite tenant FKs:

```text
FOREIGN KEY (organization_id, branch_id)
REFERENCES organization.branches(organization_id, id)
```

### Layer 4 — Query conventions

Every tenant-owned query includes:

```text
WHERE organization_id = :organizationId
```

### Layer 5 — Optional PostgreSQL RLS

RLS may be added for an additional barrier after application isolation is correct.

## Cross-Tenant Platform Admin

Platform staff may access platform-level metadata.

Business-data support access requires:

```text
SupportSession
Reason
TimeLimit
ExplicitPermission
Audit
```

Do not silently bypass tenant boundaries.

## Tenant ID Rules

- never accept tenant ID as authority from body/query alone
- route/domain may identify candidate tenant, but authenticated/validated context confirms it
- Storefront custom domain resolves to one Store/Organization
- POS Device permanently scopes operations to its Organization + Branch
- Offline operations validate device tenant/branch on sync

## Test Requirements

Every data-access module must have negative isolation tests:

```text
create resource in Tenant A
authenticate as Tenant B
attempt GET → 404/forbidden
attempt PATCH → denied
attempt indirect reference → denied
```

Test cross-tenant foreign-key injection and IDOR explicitly.
