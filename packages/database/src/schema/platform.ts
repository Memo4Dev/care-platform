import {
  check,
  foreignKey,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { organizations } from './organization';
import { subscriptions } from './subscriptions';
import { idColumn, optimisticVersion, timestamps } from './shared';

export const platformSchema = pgSchema('platform');
export const PLATFORM_TENANT_STATUSES = ['REGISTERED', 'ACTIVE', 'SUSPENDED', 'CLOSED'] as const;
export type PlatformTenantStatus = (typeof PLATFORM_TENANT_STATUSES)[number];
export const PROVISIONING_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'] as const;
export type ProvisioningStatus = (typeof PROVISIONING_STATUSES)[number];
export const SUPPORT_SESSION_STATUSES = ['REQUESTED', 'ACTIVE', 'ENDED', 'EXPIRED'] as const;
export type SupportSessionStatus = (typeof SUPPORT_SESSION_STATUSES)[number];

export const platformTenantStatusEnum = platformSchema.enum(
  'tenant_status',
  PLATFORM_TENANT_STATUSES,
);
export const provisioningStatusEnum = platformSchema.enum(
  'provisioning_status',
  PROVISIONING_STATUSES,
);
export const supportSessionStatusEnum = platformSchema.enum(
  'support_session_status',
  SUPPORT_SESSION_STATUSES,
);
export const PLATFORM_PRINCIPAL_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type PlatformPrincipalStatus = (typeof PLATFORM_PRINCIPAL_STATUSES)[number];
export const platformPrincipalStatusEnum = platformSchema.enum(
  'principal_status',
  PLATFORM_PRINCIPAL_STATUSES,
);
export const PLATFORM_CAPABILITIES = [
  'tenant.view',
  'tenant.suspend',
  'subscription.change',
  'entitlement.override',
  'support.session',
  'platform.audit',
] as const;
export type PlatformCapability = (typeof PLATFORM_CAPABILITIES)[number];

/** Global operator identities are tied to Supabase, never an Organization user. */
export const platformPrincipals = platformSchema.table(
  'principals',
  {
    id: idColumn(),
    supabaseUserId: text('supabase_user_id').notNull(),
    status: platformPrincipalStatusEnum('status').notNull().default('ACTIVE'),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [unique('platform_principals_supabase_user_unique').on(table.supabaseUserId)],
);
export const platformRoles = platformSchema.table(
  'roles',
  { id: idColumn(), code: text('code').notNull(), name: text('name').notNull(), ...timestamps },
  (table) => [unique('platform_roles_code_unique').on(table.code)],
);
export const platformCapabilities = platformSchema.table(
  'capabilities',
  { id: idColumn(), code: text('code').notNull(), description: text('description').notNull() },
  (table) => [unique('platform_capabilities_code_unique').on(table.code)],
);
export const platformRoleCapabilities = platformSchema.table(
  'role_capabilities',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => platformRoles.id, { onDelete: 'cascade' }),
    capabilityId: uuid('capability_id')
      .notNull()
      .references(() => platformCapabilities.id, { onDelete: 'restrict' }),
  },
  (table) => [
    unique('platform_role_capabilities_unique').on(table.roleId, table.capabilityId),
    index('platform_role_capabilities_capability_idx').on(table.capabilityId),
  ],
);
export const platformPrincipalRoles = platformSchema.table(
  'principal_roles',
  {
    principalId: uuid('principal_id')
      .notNull()
      .references(() => platformPrincipals.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => platformRoles.id, { onDelete: 'restrict' }),
  },
  (table) => [
    unique('platform_principal_roles_unique').on(table.principalId, table.roleId),
    index('platform_principal_roles_role_idx').on(table.roleId),
  ],
);

/** Operator-owned metadata; it never owns or deletes Organization business history. */
export const platformTenants = platformSchema.table(
  'tenants',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    status: platformTenantStatusEnum('status').notNull().default('REGISTERED'),
    provisioningStatus: provisioningStatusEnum('provisioning_status').notNull().default('PENDING'),
    subscriptionId: uuid('subscription_id'),
    subscriptionVersion: integer('subscription_version'),
    suspendedReason: text('suspended_reason'),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    unique('platform_tenants_organization_unique').on(table.organizationId),
    unique('platform_tenants_subscription_unique').on(table.subscriptionId),
    unique('platform_tenants_id_organization_unique').on(table.id, table.organizationId),
    foreignKey({
      name: 'platform_tenants_subscription_organization_fk',
      columns: [table.subscriptionId, table.organizationId],
      foreignColumns: [subscriptions.id, subscriptions.organizationId],
    }).onDelete('restrict'),
    index('platform_tenants_status_idx').on(table.status),
    check(
      'platform_tenants_suspend_reason_check',
      sql`${table.status} <> 'SUSPENDED' OR ${table.suspendedReason} IS NOT NULL`,
    ),
  ],
);

/** Explicit operator support authorization; never a tenant-user masquerade token. */
export const supportSessions = platformSchema.table(
  'support_sessions',
  {
    id: idColumn(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => platformTenants.id, { onDelete: 'restrict' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    status: supportSessionStatusEnum('status').notNull().default('REQUESTED'),
    reason: text('reason').notNull(),
    requestedByPlatformUserId: uuid('requested_by_platform_user_id')
      .notNull()
      .references(() => platformPrincipals.id, { onDelete: 'restrict' }),
    startedByPlatformUserId: uuid('started_by_platform_user_id').references(
      () => platformPrincipals.id,
      { onDelete: 'restrict' },
    ),
    endedByPlatformUserId: uuid('ended_by_platform_user_id').references(
      () => platformPrincipals.id,
      { onDelete: 'restrict' },
    ),
    requestedByLegacy: text('requested_by').notNull(),
    startedByLegacy: text('started_by'),
    endedByLegacy: text('ended_by'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endReason: text('end_reason'),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    unique('support_sessions_tenant_organization_unique').on(table.id, table.organizationId),
    foreignKey({
      name: 'support_sessions_tenant_organization_fk',
      columns: [table.tenantId, table.organizationId],
      foreignColumns: [platformTenants.id, platformTenants.organizationId],
    }).onDelete('restrict'),
    index('support_sessions_tenant_status_expiry_idx').on(
      table.tenantId,
      table.status,
      table.expiresAt,
    ),
    index('support_sessions_organization_status_expiry_idx').on(
      table.organizationId,
      table.status,
      table.expiresAt,
    ),
    check(
      'support_sessions_expiry_after_request_check',
      sql`${table.expiresAt} > ${table.requestedAt}`,
    ),
    check(
      'support_sessions_terminal_audit_check',
      sql`${table.status} NOT IN ('ENDED', 'EXPIRED') OR (${table.endedAt} IS NOT NULL AND ${table.endedByPlatformUserId} IS NOT NULL AND ${table.endReason} IS NOT NULL)`,
    ),
  ],
);
