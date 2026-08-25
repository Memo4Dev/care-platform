import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './identity';
import { organizations } from './organization';
import { idColumn, optimisticVersion, timestamps } from './shared';

/** Plans & Entitlements bounded-context persistence. */
export const entitlementsSchema = pgSchema('entitlements');

export const PLAN_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const planStatusEnum = entitlementsSchema.enum('plan_status', PLAN_STATUSES);

/** JSON entitlement values are either feature booleans or non-negative integer limits. */
export type EntitlementValue = boolean | number;

/** Global SaaS plan. Business modules must not inspect its code. */
export const plans = entitlementsSchema.table(
  'plans',
  {
    id: idColumn(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    status: planStatusEnum('status').notNull().default('DRAFT'),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [unique('plans_code_unique').on(table.code)],
);

/** Current replace-set of feature and limit values belonging to one plan. */
export const planEntitlements = entitlementsSchema.table(
  'plan_entitlements',
  {
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    code: text('entitlement_code').notNull(),
    valueJson: jsonb('value_json').$type<EntitlementValue>().notNull(),
  },
  (table) => [
    primaryKey({ name: 'plan_entitlements_pk', columns: [table.planId, table.code] }),
    index('plan_entitlements_code_idx').on(table.code),
  ],
);

/** Explicit, audited temporary tenant entitlement override. */
export const tenantOverrides = entitlementsSchema.table(
  'tenant_overrides',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    code: text('entitlement_code').notNull(),
    valueJson: jsonb('value_json').$type<EntitlementValue>().notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    reason: text('reason').notNull(),
    grantedBy: uuid('granted_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A same-tenant actor is mandatory; a raw cross-tenant actor injection is
    // rejected by this composite FK, not merely application convention.
    foreignKey({
      name: 'tenant_overrides_granted_by_tenant_fk',
      columns: [table.grantedBy, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete('restrict'),
    check(
      'tenant_overrides_effective_window_valid',
      sql`(${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom})`,
    ),
    index('tenant_overrides_organization_code_window_idx').on(
      table.organizationId,
      table.code,
      table.effectiveFrom,
    ),
    index('tenant_overrides_granted_by_idx').on(table.grantedBy),
  ],
);
