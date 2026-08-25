# Migration Status

Greenfield runtime. No legacy application migration.
Import support planned for MongoDB, Excel/CSV and other databases.
No application or database migration work performed in M0-001 through M0-005.

M1-001: Drizzle migration infrastructure created (`packages/database`, drizzle-kit config, `drizzle/` folder with empty journal). Zero business migrations generated — business schemas arrive with later M1 tasks (organization/identity/platform).

M1-003: First business migration generated and committed: `packages/database/drizzle/0000_concerned_tana_nile.sql`

- Creates logical schemas `organization` and `integration`.
- Creates enums `organization.organization_status` (ACTIVE|SUSPENDED) and `organization.organization_policy_type` (RETURN|REFUND|PURCHASE|ORDER_APPROVAL|OFFLINE|CREDIT|DELIVERY|INVENTORY).
- Creates tables: organization.organizations, organization.branches (UNIQUE(organization_id, code), tenant-scope UNIQUE(id, organization_id)), organization.warehouses (composite tenant FK to branches(id, organization_id)), organization.organization_policies (append-only, UNIQUE(organization_id, version), latest-lookup index), integration.outbox (occurred_at index).
- Non-destructive, additive-only; applied automatically by the test harness via runMigrations. No production rollout performed.

M1-005: Additive Drizzle migration `0005_supreme_wild_child.sql` creates logical schema `entitlements`, plan status enum, and plans/plan_entitlements/tenant_overrides tables.

- `plans` has unique code and mutable CAS version; `plan_entitlements` uses a composite primary key and plan FK; `tenant_overrides` is organization-scoped, validates effective windows, indexes entitlement resolution, and has a composite same-tenant grantor FK to identity users.
- Non-destructive, additive-only; applied automatically by the native-PG test harness. No production rollout performed.

M1-005 review remediation: no additional database migration. `event_scope` is an additive field inside the existing JSONB integration outbox envelope, so schema storage remains backward-compatible; producers and consumers validate the payload invariant in application code.

M1-004 review remediation: additive `0003_identity_organization_roles.sql` adds organization-scoped role grants with composite user/role tenant FKs and indexes.

- Drizzle metadata journals/snapshots for applied `0002` and `0003` were repaired without changing their SQL; `pnpm --filter @commerce-platform/database generate` reports no schema changes.

M1-004 final security remediation: additive `0004_lush_hannibal_king.sql` creates `identity.initial_owner_assignments`, keyed by `organization_id` with composite same-organization user and role FKs. The table is the durable single-initial-Owner claim and does not constrain normal organization-role grants.

M1-004: Additive Identity & Access migration generated locally: `packages/database/drizzle/0002_dark_shard.sql`.

- Creates logical schema `identity`, enum `identity.user_status` (ACTIVE|SUSPENDED), and tables identity.users, identity.roles, identity.permissions, identity.role_permissions, identity.user_branch_roles and identity.branch_access.
- Adds global user email uniqueness plus `lower(email)` unique-index enforcement for case-insensitive raw writers, nullable globally unique Supabase identity links, mutable root versions, FK indexes, and composite tenant FKs tying grants/access to same-organization users, branches and roles.
- Idempotently seeds the static global capability catalog with `ON CONFLICT (code) DO NOTHING`.
- Non-destructive, additive-only; applied automatically by the test harness via runMigrations. No production rollout performed.
