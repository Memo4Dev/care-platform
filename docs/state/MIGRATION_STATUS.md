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

M1-008: Additive migration `0015_tenant_provisioning.sql` creates logical schema `provisioning`, its exact checkpointed process-state enum, and `provisioning.tenant_provisioning`.

- Records are uniquely keyed by both Platform Tenant and Organization, retain current step/checkpoints/last error/completion time, use optimistic versions, enforce the same-tenant composite Platform Tenant/Organization FK, and index status for retry/worker selection.
- Non-destructive, additive-only; applied automatically by the native-PG test harness. No production rollout performed.

M1-008 hardening: additive migrations `0016_platform_registration_snapshot.sql` and `0017_provisioning_terminal_immutability.sql` retain the verified registration reference, requested organization and verified owner identity snapshot on `platform.tenants`, mark all pre-existing/default registration rows `LEGACY` rather than VERIFIED, prevent reuse of a non-legacy verified reference, and make completed provisioning records physically immutable.

- `0017` installs PostgreSQL triggers that reject registration-snapshot mutation and UPDATE/DELETE of a completed process row with SQLSTATE `55000`; it does not restrict retries of a non-terminal failed process. Both migrations are additive-only and are applied by the native-PG test harness; no production rollout performed.

M1-005 review remediation: no additional database migration. `event_scope` is an additive field inside the existing JSONB integration outbox envelope, so schema storage remains backward-compatible; producers and consumers validate the payload invariant in application code.

M1-004 review remediation: additive `0003_identity_organization_roles.sql` adds organization-scoped role grants with composite user/role tenant FKs and indexes.

- Drizzle metadata journals/snapshots for applied `0002` and `0003` were repaired without changing their SQL; `pnpm --filter @commerce-platform/database generate` reports no schema changes.

M1-004 final security remediation: additive `0004_lush_hannibal_king.sql` creates `identity.initial_owner_assignments`, keyed by `organization_id` with composite same-organization user and role FKs. The table is the durable single-initial-Owner claim and does not constrain normal organization-role grants.

M1-004: Additive Identity & Access migration generated locally: `packages/database/drizzle/0002_dark_shard.sql`.

- Creates logical schema `identity`, enum `identity.user_status` (ACTIVE|SUSPENDED), and tables identity.users, identity.roles, identity.permissions, identity.role_permissions, identity.user_branch_roles and identity.branch_access.
- Adds global user email uniqueness plus `lower(email)` unique-index enforcement for case-insensitive raw writers, nullable globally unique Supabase identity links, mutable root versions, FK indexes, and composite tenant FKs tying grants/access to same-organization users, branches and roles.
- Idempotently seeds the static global capability catalog with `ON CONFLICT (code) DO NOTHING`.
- Non-destructive, additive-only; applied automatically by the test harness via runMigrations. No production rollout performed.

M1-006: Additive Drizzle migrations `0006_tearful_husk.sql` and `0007_fancy_cyclops.sql` create logical schema `subscription`, lifecycle/billing enums, and subscription persistence.

- `subscription.subscriptions` has organization and plan FKs, CAS version, period validity check, period-expiry lookup indexes, and a partial unique index enforcing one TRIAL/ACTIVE/PAST_DUE/SUSPENDED commercial subscription per organization.
- `subscription.subscription_periods` is append-only at the repository level, with plan/subscription FKs, valid-period check, immutable effective-time uniqueness and lookup index.
- Non-destructive, additive-only; applied automatically by the native-PG test harness. No production rollout performed.

M1-006 blocker remediation: additive migration `0008_subscription_periods_append_only.sql` creates `subscription.reject_subscription_period_mutation()` and a `BEFORE UPDATE OR DELETE` trigger on `subscription.subscription_periods`.

- The trigger raises SQLSTATE `55000` for direct history mutation. INSERT remains allowed for the aggregate's new historical facts.
- Non-destructive, additive-only; applied automatically by the native-PG test harness. No production rollout performed.

M1-007: Additive Drizzle migrations `0009_nifty_aqueduct.sql` through `0013_platform-authorization.sql` create logical schema `platform`.

- Creates platform tenant/provisioning/support-session enums, `platform.tenants`, and `platform.support_sessions`; tenant Organization and optional Subscription references are restrictive, Organization mapping is unique, and mutable roots use CAS versions. `0012` safely converts the initially generated subscription-version reference to the Subscription aggregate's integer version.
- Support sessions carry reason, requested/started/ended actor and timestamp audit fields, mandatory expiry, lifecycle status, lookup indexes, and a composite `(tenant_id, organization_id)` FK that rejects cross-tenant support-session injection.
- `0013` adds Supabase-linked platform principals, roles, capabilities and assignments; adds platform-principal support audit references; and replaces the direct Subscription FK with a composite `(subscription_id, organization_id)` tenant-scope FK.
- Non-destructive, additive-only; applied automatically by the native-PG test harness. No production rollout performed.
