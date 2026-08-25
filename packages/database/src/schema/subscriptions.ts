import {
  boolean,
  check,
  index,
  numeric,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { plans } from './entitlements';
import { organizations } from './organization';
import { idColumn, optimisticVersion, timestamps } from './shared';

export const subscriptionSchema = pgSchema('subscription');
export const SUBSCRIPTION_STATUSES = [
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const BILLING_CYCLES = ['MONTHLY', 'YEARLY'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];
export const subscriptionStatusEnum = subscriptionSchema.enum(
  'subscription_status',
  SUBSCRIPTION_STATUSES,
);
export const billingCycleEnum = subscriptionSchema.enum('billing_cycle', BILLING_CYCLES);

/** SaaS commercial aggregate root. One non-terminal commercial subscription per organization. */
export const subscriptions = subscriptionSchema.table(
  'subscriptions',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    status: subscriptionStatusEnum('status').notNull(),
    billingCycle: billingCycleEnum('billing_cycle').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    billingProvider: text('billing_provider'),
    billingProviderReference: text('billing_provider_reference'),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    check(
      'subscriptions_period_valid',
      sql`${table.currentPeriodEnd} > ${table.currentPeriodStart}`,
    ),
    index('subscriptions_organization_status_period_end_idx').on(
      table.organizationId,
      table.status,
      table.currentPeriodEnd,
    ),
    unique('subscriptions_id_organization_unique').on(table.id, table.organizationId),
    uniqueIndex('subscriptions_one_commercial_per_organization_unique')
      .on(table.organizationId)
      .where(sql`${table.status} in ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED')`),
    index('subscriptions_plan_id_idx').on(table.planId),
  ],
);

/** Immutable period / plan history. A correction is a new row, never an update. */
export const subscriptionPeriods = subscriptionSchema.table(
  'subscription_periods',
  {
    id: idColumn(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'restrict' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    status: subscriptionStatusEnum('status').notNull(),
    amount: numeric('amount', { precision: 18, scale: 4 }),
    currency: text('currency'),
    billingReference: text('billing_reference'),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('subscription_periods_period_valid', sql`${table.periodEnd} > ${table.periodStart}`),
    unique('subscription_periods_subscription_effective_unique').on(
      table.subscriptionId,
      table.effectiveAt,
    ),
    index('subscription_periods_subscription_effective_idx').on(
      table.subscriptionId,
      table.effectiveAt,
    ),
  ],
);
