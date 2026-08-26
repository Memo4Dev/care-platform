import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgSchema, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organization';
import { idColumn, optimisticVersion } from './shared';

export const provisioningSchema = pgSchema('provisioning');
export const TENANT_PROVISIONING_STATUSES = [
  'REQUESTED',
  'CREATING_ORGANIZATION',
  'CREATING_IDENTITY_DEFAULTS',
  'CREATING_BUSINESS_DEFAULTS',
  'CREATING_STOREFRONT',
  'COMPLETED',
  'FAILED',
] as const;
export type TenantProvisioningStatus = (typeof TENANT_PROVISIONING_STATUSES)[number];
export const tenantProvisioningStatusEnum = provisioningSchema.enum(
  'tenant_provisioning_status',
  TENANT_PROVISIONING_STATUSES,
);

/** Durable tenant-scoped process-manager state. */
export const tenantProvisioning = provisioningSchema.table(
  'tenant_provisioning',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    status: tenantProvisioningStatusEnum('status').notNull().default('REQUESTED'),
    currentStep: text('current_step').notNull(),
    checkpointsJson: jsonb('checkpoints_json')
      .$type<Record<string, { completedAt?: string; skipped?: boolean }>>()
      .notNull()
      .default({}),
    lastError: text('last_error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    version: optimisticVersion,
  },
  (table) => [
    unique('tenant_provisioning_tenant_unique').on(table.tenantId),
    unique('tenant_provisioning_organization_unique').on(table.organizationId),
    index('tenant_provisioning_status_idx').on(table.status),
    check(
      'tenant_provisioning_completed_at_check',
      sql`${table.status} <> 'COMPLETED' OR ${table.completedAt} IS NOT NULL`,
    ),
  ],
);

/** Durable command acceptance record for the asynchronous provisioning retry saga. */
export const provisioningRetryRequests = provisioningSchema.table(
  'retry_requests',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id').notNull(),
    provisioningId: uuid('provisioning_id'),
    registrationReference: text('registration_reference').notNull(),
    idempotencyScope: text('idempotency_scope').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    eventId: uuid('event_id').notNull(),
    status: text('status').notNull().default('REQUESTED'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('provisioning_retry_requests_scope_key_unique').on(
      table.idempotencyScope,
      table.idempotencyKey,
    ),
    unique('provisioning_retry_requests_event_unique').on(table.eventId),
    index('provisioning_retry_requests_tenant_status_idx').on(table.tenantId, table.status),
  ],
);
