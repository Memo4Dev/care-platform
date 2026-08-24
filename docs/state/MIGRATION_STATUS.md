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
