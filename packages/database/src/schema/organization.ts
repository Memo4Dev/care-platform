import { desc } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { idColumn, optimisticVersion, timestamps } from './shared';

/**
 * Organization bounded context (docs/architecture/10-organization.md).
 *
 * Logical schema `organization` (docs/architecture/30-persistence-overview.md):
 * organizations / branches / warehouses / organization_policies.
 *
 * Conventions applied here:
 * - Every tenant-owned row carries `organization_id`; business uniqueness is
 *   expressed as UNIQUE (organization_id, business_key).
 * - Branches expose UNIQUE (id, organization_id) as a composite "tenant scope"
 *   anchor so child tables can pin both the parent row and its tenant in one
 *   composite FK (Layer 3 of docs/architecture/71-multi-tenant-isolation.md).
 */

export const organizationSchema = pgSchema('organization');

/** JSON shape stored in `organization_policies.value_json`. */
export type PolicyValue = Record<string, unknown>;

export const ORGANIZATION_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const POLICY_TYPES = [
  'RETURN',
  'REFUND',
  'PURCHASE',
  'ORDER_APPROVAL',
  'OFFLINE',
  'CREDIT',
  'DELIVERY',
  'INVENTORY',
] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];

export const organizationStatusEnum = organizationSchema.enum(
  'organization_status',
  ORGANIZATION_STATUSES,
);

export const organizationPolicyTypeEnum = organizationSchema.enum(
  'organization_policy_type',
  POLICY_TYPES,
);

/**
 * The tenant root. Its lifecycle status gates business access platform-wide
 * (suspended organizations are rejected by consumers of this context's
 * contracts), while historical data stays intact.
 */
export const organizations = organizationSchema.table('organizations', {
  id: idColumn(),
  name: text('name').notNull(),
  status: organizationStatusEnum('status').notNull().default('ACTIVE'),
  ...timestamps,
  version: optimisticVersion,
});

/**
 * Branch: fulfillment/operations unit inside one organization.
 *
 * `branches_tenant_scope_unique` makes (id, organization_id) referenceable so
 * child tables (e.g. warehouses) can carry a composite tenant FK that fails
 * closed when the child's organization_id does not match the branch's owner.
 */
export const branches = organizationSchema.table(
  'branches',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    priority: integer('priority').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    unique('branches_org_code_unique').on(table.organizationId, table.code),
    unique('branches_tenant_scope_unique').on(table.id, table.organizationId),
    // Postgres does not auto-index FK columns; keep tenant-scoped lookups and
    // cascade deletes indexed.
    index('branches_organization_id_idx').on(table.organizationId),
  ],
);

/**
 * Warehouse: stock location attached to exactly one branch of the same
 * organization. Integrity beyond the plain organization FK is enforced by
 * `warehouses_branch_tenant_fk`, which references the composite tenant anchor
 * above: (branch_id, organization_id) -> branches (id, organization_id).
 */
export const warehouses = organizationSchema.table(
  'warehouses',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    unique('warehouses_org_branch_code_unique').on(
      table.organizationId,
      table.branchId,
      table.code,
    ),
    // Postgres does not auto-index FK columns; keep tenant/branch lookups and
    // cascade deletes indexed.
    index('warehouses_organization_id_idx').on(table.organizationId),
    index('warehouses_branch_id_idx').on(table.branchId),
    foreignKey({
      name: 'warehouses_branch_tenant_fk',
      columns: [table.branchId, table.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }),
  ],
);

/**
 * Append-only organization policy history (docs/architecture/10-organization.md:
 * "Policy changes are versioned and do not rewrite completed transactions").
 *
 * - One immutable row per change; rows are never updated or deleted.
 * - `version` is a per-organization monotonic sequence assigned by the domain;
 *   UNIQUE (organization_id, version) enforces the monotonic invariant.
 * - "Latest policy" lookups use the (organization_id, policy_type,
 *   version DESC) index.
 */
export const organizationPolicies = organizationSchema.table(
  'organization_policies',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    policyType: organizationPolicyTypeEnum('policy_type').notNull(),
    valueJson: jsonb('value_json').$type<PolicyValue>().notNull(),
    version: integer('version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('organization_policies_org_version_unique').on(
      table.organizationId,
      table.version,
    ),
    index('organization_policies_latest_idx').on(
      table.organizationId,
      table.policyType,
      desc(table.version),
    ),
  ],
);
