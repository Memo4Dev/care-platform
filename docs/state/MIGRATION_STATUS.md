# Migration Status

Greenfield runtime. No legacy application migration.
Import support planned for MongoDB, Excel/CSV and other databases.
No application or database migration work performed in M0-001 through M0-005.

## M1-001: Drizzle migration infrastructure

`packages/database`, drizzle-kit config, `drizzle/` folder with empty journal. Zero business migrations generated — business schemas arrive with later M1 tasks.

## M1-003: Organization domain

`0000_concerned_tana_nile.sql` — First business migration.

- Creates logical schemas `organization` and `integration`.
- Creates enums `organization.organization_status` (ACTIVE|SUSPENDED) and `organization.organization_policy_type` (RETURN|REFUND|PURCHASE|ORDER_APPROVAL|OFFLINE|CREDIT|DELIVERY|INVENTORY).
- Creates tables: organization.organizations, organization.branches (UNIQUE(organization_id, code), tenant-scope UNIQUE(id, organization_id)), organization.warehouses (composite tenant FK to branches(id, organization_id)), organization.organization_policies (append-only, UNIQUE(organization_id, version), latest-lookup index), integration.outbox (occurred_at index).
- Non-destructive, additive-only.

## M1-004: Identity & Access

`0001_spicy_viper.sql` — Identity schema and base tables.

- Creates logical schema `identity`, enum `identity.user_status` (ACTIVE|SUSPENDED), and tables identity.users, identity.roles, identity.permissions, identity.role_permissions, identity.user_branch_roles and identity.branch_access.
- Adds global user email uniqueness plus `lower(email)` unique-index enforcement, nullable globally unique Supabase identity links, mutable root versions, FK indexes, and composite tenant FKs.
- Idempotently seeds the static global capability catalog with `ON CONFLICT (code) DO NOTHING`.

`0002_dark_shard.sql` — Identity schema (Drizzle-generated, same content as 0001 per journal).

`0003_identity_organization_roles.sql` — Organization-scoped role grants with composite user/role tenant FKs and indexes.

- Drizzle metadata journals/snapshots for 0002 and 0003 were repaired without changing SQL; `generate` reports no schema changes.

`0004_lush_hannibal_king.sql` — Durable bootstrap Owner claim.

- Creates `identity.initial_owner_assignments`, keyed by `organization_id` with composite same-organization user and role FKs. Single-initial-Owner claim; does not constrain normal organization-role grants.

## M1-005: Plans & Entitlements

`0005_supreme_wild_child.sql` — Entitlements schema.

- Creates logical schema `entitlements`, plan status enum, and plans/plan_entitlements/tenant_overrides tables.
- `plans` has unique code and mutable CAS version; `plan_entitlements` uses composite primary key and plan FK; `tenant_overrides` is organization-scoped with composite same-tenant grantor FK to identity users.

## M1-006: Subscription & Billing

`0006_tearful_husk.sql` and `0007_fancy_cyclops.sql` — Subscription schema.

- Creates logical schema `subscription`, lifecycle/billing enums, and subscription persistence.
- `subscription.subscriptions` has organization and plan FKs, CAS version, period validity check, and partial unique index enforcing one TRIAL/ACTIVE/PAST_DUE/SUSPENDED commercial subscription per organization.
- `subscription.subscription_periods` is append-only at the repository level with plan/subscription FKs and immutable effective-time uniqueness.

`0008_subscription_periods_append_only.sql` — Physical append-only trigger.

- Creates `subscription.reject_subscription_period_mutation()` and a `BEFORE UPDATE OR DELETE` trigger on `subscription.subscription_periods`. Raises SQLSTATE `55000` for direct history mutation.

## M1-007: Platform Management

`0009_nifty_aqueduct.sql` through `0013_platform-authorization.sql` — Platform schema (5 migrations).

- Creates logical schema `platform` with platform tenant/provisioning/support-session enums, `platform.tenants`, and `platform.support_sessions`.
- Tenant Organization and optional Subscription references are restrictive; Organization mapping is unique; mutable roots use CAS versions.
- `0012` safely converts the initially generated subscription-version reference to the Subscription aggregate's integer version.
- Support sessions carry reason, requested/started/ended actor and timestamp audit fields, mandatory expiry, lifecycle status, and composite `(tenant_id, organization_id)` FK.
- `0013` adds Supabase-linked platform principals, roles, capabilities and assignments; platform-principal support audit references; replaces the direct Subscription FK with a composite `(subscription_id, organization_id)` tenant-scope FK.

`0014_support-session-terminal-audit.sql` — Support session terminal audit.

## M1-008: Tenant Provisioning

`0015_tenant_provisioning.sql` — Provisioning schema.

- Creates logical schema `provisioning`, its exact checkpointed process-state enum, and `provisioning.tenant_provisioning`.
- Records uniquely keyed by both Platform Tenant and Organization, retain current step/checkpoints/last error/completion time, use optimistic versions, enforce same-tenant composite FK, and index status for retry/worker selection.

`0016_platform_registration_snapshot.sql` — Registration snapshot.

- Retains verified registration reference, requested organization, and verified owner identity snapshot on `platform.tenants`. Marks pre-existing/default registration rows `LEGACY` rather than VERIFIED. Prevents reuse of a non-legacy verified reference.

`0017_provisioning_terminal_immutability.sql` — Terminal process immutability.

- PostgreSQL triggers that reject registration-snapshot mutation and UPDATE/DELETE of a completed process row with SQLSTATE `55000`. Does not restrict retries of a non-terminal failed process.

## M1-009: Tenant Override Attribution + HTTP Idempotency + Delivery

`0018_tenant_override_actor_attribution.sql` — Override actor attribution.

- Adds `actor_type`, `actor_id` and `correlation_id` to `entitlements.tenant_overrides`. Former tenant-user grantor remains nullable for historical compatibility. PostgreSQL trigger permits only active Platform principal or opaque `SYSTEM:*` server actor.

`0019_http_idempotency_outcomes.sql` — HTTP idempotency outcomes.

- Creates `integration.idempotency_outcomes`. Uniquely records authenticated mutation scope, Idempotency-Key, request hash, pending/completed state and serialized response.

`0020_provisioning_retry_saga.sql` — Provisioning retry delivery.

- Creates `integration.inbox` and `provisioning.retry_requests`. Retry acceptance records idempotency-scoped workflow reference and event ID with partial unique index preventing concurrent active retry work per tenant. Inbox retains per-EventId consumer completion state.

`0021_outbox_bullmq_delivery.sql` — Outbox→BullMQ relay/worker delivery.

- Adds Outbox publication timestamp, relay lease, attempt/error state, supporting claim index, and opaque Inbox lease ID. Supports crash-safe relay recovery.

---

## Summary: All 23 M1/M3 migrations

| #    | File                                          | Domain                   | Description                                                      |
| ---- | --------------------------------------------- | ------------------------ | ---------------------------------------------------------------- |
| 0000 | `0000_concerned_tana_nile.sql`                | Organization             | Schema, enums, organizations/branches/warehouses/policies/outbox |
| 0001 | `0001_spicy_viper.sql`                        | Identity                 | Schema, users/roles/permissions/branch_access, capability seed   |
| 0002 | `0002_dark_shard.sql`                         | Identity                 | Drizzle-generated (metadata companion to 0001)                   |
| 0003 | `0003_identity_organization_roles.sql`        | Identity                 | Organization-scoped role grants, composite tenant FKs            |
| 0004 | `0004_lush_hannibal_king.sql`                 | Identity                 | `initial_owner_assignments` bootstrap claim table                |
| 0005 | `0005_supreme_wild_child.sql`                 | Entitlements             | Plans, plan_entitlements, tenant_overrides                       |
| 0006 | `0006_tearful_husk.sql`                       | Subscription             | Subscriptions and subscription_periods schema                    |
| 0007 | `0007_fancy_cyclops.sql`                      | Subscription             | Subscription schema (companion migration)                        |
| 0008 | `0008_subscription_periods_append_only.sql`   | Subscription             | Append-only trigger on subscription_periods                      |
| 0009 | `0009_nifty_aqueduct.sql`                     | Platform                 | Platform tenants and support sessions                            |
| 0010 | `0010_purple_lockheed.sql`                    | Platform                 | Platform schema (companion migration)                            |
| 0011 | `0011_good_dagger.sql`                        | Platform                 | Platform schema (companion migration)                            |
| 0012 | `0012_lowly_oracle.sql`                       | Platform                 | Subscription version reference type fix                          |
| 0013 | `0013_platform-authorization.sql`             | Platform                 | Platform principals, roles, capabilities, assignments            |
| 0014 | `0014_support-session-terminal-audit.sql`     | Platform                 | Support session terminal audit                                   |
| 0015 | `0015_tenant_provisioning.sql`                | Provisioning             | Process manager schema with checkpoint enum                      |
| 0016 | `0016_platform_registration_snapshot.sql`     | Provisioning             | Registration snapshot + legacy marking                           |
| 0017 | `0017_provisioning_terminal_immutability.sql` | Provisioning             | Terminal process immutability trigger                            |
| 0018 | `0018_tenant_override_actor_attribution.sql`  | Entitlements             | Override actor_type/actor_id/correlation_id + trigger            |
| 0019 | `0019_http_idempotency_outcomes.sql`          | Integration              | HTTP idempotency outcomes table                                  |
| 0020 | `0020_provisioning_retry_saga.sql`            | Integration/Provisioning | Inbox + retry_requests delivery tables                           |
| 0021 | `0021_outbox_bullmq_delivery.sql`             | Integration              | Outbox relay publication/lease + Inbox lease                     |
| 0024 | `0024_inventory_core.sql`                     | Inventory                | Inventory schema: stock_positions, fifo_layers, ledger_entries, reservations, allocations, transfers, adjustments |
| 0025 | `0025_add_inventory_permissions.sql`           | Identity/Inventory       | Seeds `inventory.create` permission code into identity.permissions |

All migrations are additive-only. No destructive DDL. No production rollout performed (test harness applied).

## M3-001: Inventory Core Persistence

`0024_inventory_core.sql` — Inventory schema and core tables.

- Creates logical schema `inventory`.
- Creates tables:
  - `inventory.stock_positions` — Core aggregate identity with (organization_id, warehouse_id, variant_id) uniqueness. CHECK constraints enforce non-negative on_hand/reserved/allocated and reserved + allocated <= on_hand. Composite tenant FKs to warehouses and product_variants. Optimistic version for balance mutations.
  - `inventory.fifo_layers` — Append-only cost layers for FIFO consumption. Partial index on remaining_quantity > 0 accelerates oldest-first consumption query.
  - `inventory.ledger_entries` — Immutable movement history. Uses DB-side gen_random_uuid() for IDs. Indexes on organization_id, stock_position_id, and (reference_type, reference_id).
  - `inventory.reservations` — Temporary stock holds with status lifecycle (ACTIVE/CONSUMED/RELEASED/EXPIRED), expiry support, and optimistic version.
  - `inventory.reservation_items` — Line items within a reservation, FK to parent reservation.
  - `inventory.allocations` — Confirmed stock commitments with status lifecycle and optimistic version.
  - `inventory.stock_transfers` — Inter-warehouse transfers with lifecycle (DRAFT/DISPATCHED/IN_TRANSIT/RECEIVED/CANCELLED). Composite FKs to source and destination warehouses.
  - `inventory.stock_transfer_items` — Line items with received_quantity for partial receipt tracking.
  - `inventory.stock_adjustments` — Immutable audit trail for manual corrections with before/after quantities and approval tracking.
- All DDL is idempotent (IF NOT EXISTS).
- Drizzle schema: `packages/database/src/schema/inventory.ts`.

## M3-004: Inventory Permissions

`0025_add_inventory_permissions.sql` — Seeds inventory permission.

- Inserts `inventory.create` into `identity.permissions` with ON CONFLICT DO NOTHING.
- Combined with pre-existing `inventory.view`, `inventory.adjust`, and `inventory.transfer` from M1 migration `0002_dark_shard.sql`.
- OWNER and ADMIN get full inventory permissions; SALES and WAREHOUSE get read-only (`inventory.view`).
