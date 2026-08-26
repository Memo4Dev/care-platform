import {
  boolean,
  foreignKey,
  index,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { idColumn, optimisticVersion, timestamps } from './shared';
import { branches, organizations } from './organization';

/**
 * Identity & Access bounded context (docs/architecture/11-identity-access.md).
 *
 * Logical schema `identity` (docs/architecture/30-persistence-overview.md):
 * users / roles / permissions / role_permissions / user_branch_roles /
 * branch_access. POS device identities arrive with M8 and are intentionally
 * absent here.
 *
 * Conventions applied here (M1-003 baseline):
 * - Every tenant-owned row carries `organization_id`; business uniqueness is
 *   expressed as UNIQUE (organization_id, business_key).
 * - `users_tenant_scope_unique` and `roles_tenant_scope_unique` expose
 *   UNIQUE (id, organization_id) composite "tenant scope" anchors so child
 *   tables can pin the parent row AND its tenant in one composite FK
 *   (Layer 3 of docs/architecture/71-multi-tenant-isolation.md).
 * - Mutable aggregates (`users`, `roles`) carry optimistic concurrency
 *   version columns.
 * - Postgres does not auto-index FK columns; every FK column gets an index.
 */
export const identitySchema = pgSchema('identity');

// ---------------------------------------------------------------------------
// Static permission catalog (global, NOT per-organization)
// ---------------------------------------------------------------------------

/**
 * Every capability code, verbatim from docs/architecture/72-authorization-matrix.md
 * ("Capability Matrix") plus `sales.edit`, the one additional important
 * permission listed in docs/architecture/11-identity-access.md that the
 * matrix does not cover. Codes are stable contract values: adding is additive,
 * renaming/removing is breaking.
 */
export const PERMISSION_CODES = [
  'sales.create',
  'sales.edit',
  'sales.cancel',
  'price.override',
  'discount.override',
  'order.approve',
  'refund.create',
  'refund.override',
  'inventory.view',
  'inventory.adjust',
  'inventory.transfer',
  'purchase.create',
  'purchase.approve',
  'credit.use',
  'credit.override',
  'offline.resolve',
  'cash.reconcile',
  'delivery.manage',
  'users.manage',
  'roles.manage',
  'permissions.manage',
  'role-grants.manage',
  'branch-access.manage',
  'catalog.view',
  'catalog.create',
  'catalog.edit',
  'catalog.delete',
  'pricing.view',
  'pricing.create',
  'pricing.edit',
  'pricing.delete',
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

/** Human-readable description for every catalog entry, keyed by code. */
export const PERMISSION_DESCRIPTIONS: Record<PermissionCode, string> = {
  'sales.create': 'Create POS and counter sales.',
  'sales.edit': 'Edit a sale before completion.',
  'sales.cancel': 'Cancel a sale.',
  'price.override': 'Override a computed price.',
  'discount.override': 'Apply discounts beyond normal limits.',
  'order.approve': 'Approve customer orders.',
  'refund.create': 'Create refunds for completed sales.',
  'refund.override': 'Override refund rules and limits.',
  'inventory.view': 'View stock levels and inventory positions.',
  'inventory.adjust': 'Post stock adjustments.',
  'inventory.transfer': 'Create and move stock transfers between branches.',
  'purchase.create': 'Create purchase orders.',
  'purchase.approve': 'Approve purchase orders.',
  'credit.use': 'Sell on customer credit accounts.',
  'credit.override': 'Override credit limits and holds.',
  'offline.resolve': 'Resolve offline sync conflicts.',
  'cash.reconcile': 'Reconcile cash sessions.',
  'delivery.manage': 'Manage deliveries and delivery assignments.',
  'users.manage': 'Manage users, roles and branch access.',
  'roles.manage': 'Create and rename organization roles.',
  'permissions.manage': 'Change permissions assigned to organization roles.',
  'role-grants.manage': 'Assign and revoke organization and branch roles.',
  'branch-access.manage': 'Assign and revoke branch access.',
  'catalog.view': 'View products, variants, categories, units, and barcodes.',
  'catalog.create': 'Create products, variants, categories, units, conversions, and barcodes.',
  'catalog.edit': 'Update product, variant, category, unit, and conversion metadata.',
  'catalog.delete': 'Deactivate or discontinue catalog items.',
  'pricing.view': 'View price books, entries, promotions, coupons, and snapshots.',
  'pricing.create': 'Create price books, entries, promotions, and coupons.',
  'pricing.edit': 'Update price book entries, promotion rules, and coupon terms.',
  'pricing.delete': 'Deactivate price books, promotions, and coupons.',
};

/** Catalog rows seeded by migration; kept in sync with PERMISSION_CODES. */
export const PERMISSION_CATALOG: ReadonlyArray<{
  code: PermissionCode;
  description: string;
}> = Object.entries(PERMISSION_DESCRIPTIONS).map(([code, description]) => ({
  code: code as PermissionCode,
  description,
}));

/**
 * Global (non-tenant) permission catalog. Seeded idempotently by migration
 * (INSERT ... ON CONFLICT DO NOTHING); rows are reference data, so no
 * organization_id, no updated_at and no optimistic version.
 */
export const permissions = identitySchema.table(
  'permissions',
  {
    id: idColumn(),
    code: text('code').notNull(),
    description: text('description').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('permissions_code_unique').on(table.code),
  ],
);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const USER_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const userStatusEnum = identitySchema.enum('user_status', USER_STATUSES);

/**
 * A platform user inside exactly one organization (rule: "User belongs to one
 * Organization", docs/architecture/11-identity-access.md).
 *
 * Email is the GLOBAL login handle (Supabase Auth identities are global), so
 * uniqueness is global rather than per organization: UNIQUE(email). The
 * application normalizes emails to lowercase before persisting, making the
 * constraint case-insensitive in practice without depending on the citext
 * extension (a plain functional lower() unique index is not rendered reliably
 * by the current drizzle-kit; revisit if raw-SQL writers must be covered).
 * `supabase_user_id` links the platform user to its Supabase Auth identity.
 * It is nullable until the identity is linked (provisioning creates the user
 * first, linking happens when the auth account exists) and globally UNIQUE
 * once set. No Supabase network calls happen anywhere in this context.
 */
export const users = identitySchema.table(
  'users',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    supabaseUserId: text('supabase_user_id'),
    email: text('email').notNull(),
    name: text('name').notNull(),
    status: userStatusEnum('status').notNull().default('ACTIVE'),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    unique('users_email_unique').on(table.email),
    // Database-level case-insensitive protection for raw/administrative
    // writers. Application writes normalize first, but tenant safety must not
    // depend on every writer doing so.
    uniqueIndex('users_email_lower_unique').on(sql`lower(${table.email})`),
    unique('users_supabase_user_id_unique').on(table.supabaseUserId),
    // Tenant-scope anchor for composite FKs from membership/access tables.
    unique('users_tenant_scope_unique').on(table.id, table.organizationId),
    index('users_organization_id_idx').on(table.organizationId),
  ],
);

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/**
 * A named role of one organization. System templates (`is_system = true`,
 * e.g. the Owner/Manager/... defaults) are ordinary rows owned by their
 * organization: their permission sets REMAIN EDITABLE by holders of
 * users.manage because the authorization matrix marks most cells
 * "configurable" (docs/architecture/72-authorization-matrix.md). There is no
 * delete command for roles in v1, which trivially satisfies "system templates
 * cannot be deleted".
 */
export const roles = identitySchema.table(
  'roles',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    unique('roles_org_code_unique').on(table.organizationId, table.code),
    // Tenant-scope anchor for composite FKs from user_branch_roles.
    unique('roles_tenant_scope_unique').on(table.id, table.organizationId),
    index('roles_organization_id_idx').on(table.organizationId),
  ],
);

// ---------------------------------------------------------------------------
// Role <-> permission assignments
// ---------------------------------------------------------------------------

/**
 * Which permissions a role grants. Replace-set semantics live in the Role
 * aggregate; storage is a plain join table keyed by (role_id, permission_id).
 */
export const rolePermissions = identitySchema.table(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'restrict' }),
  },
  (table) => [
    primaryKey({ name: 'role_permissions_pk', columns: [table.roleId, table.permissionId] }),
    // The composite PK indexes role_id lookups; permission-side lookups
    // ("which roles grant X") need their own index.
    index('role_permissions_permission_id_idx').on(table.permissionId),
  ],
);

// ---------------------------------------------------------------------------
// Branch-scoped role assignments
// ---------------------------------------------------------------------------

/**
 * Role grants are BRANCH-SCOPED (rules: "User may access one or multiple
 * Branches" and "Role/permissions may differ per Branch",
 * docs/architecture/11-identity-access.md). Rows are never mutated: granting
 * inserts, revoking deletes.
 *
 * Tenant discipline (Layer 3 of docs/architecture/71-multi-tenant-isolation.md):
 * the row carries its own organization_id plus three composite tenant FKs so a
 * row can only exist when user, branch and role ALL belong to the same
 * organization — cross-tenant injections fail closed at the database even for
 * writers bypassing the application.
 *
 * Holding any role on a branch IMPLIES branch access (see branch_access);
 * this table additionally feeds the effective-permission projection.
 */
export const userBranchRoles = identitySchema.table(
  'user_branch_roles',
  {
    userId: uuid('user_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    roleId: uuid('role_id').notNull(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'user_branch_roles_pk',
      columns: [table.userId, table.branchId, table.roleId],
    }),
    foreignKey({
      name: 'user_branch_roles_user_tenant_fk',
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'user_branch_roles_branch_tenant_fk',
      columns: [table.branchId, table.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'user_branch_roles_role_tenant_fk',
      columns: [table.roleId, table.organizationId],
      foreignColumns: [roles.id, roles.organizationId],
    }).onDelete('cascade'),
    // PK prefix covers user-side reads; reverse and tenant lookups indexed.
    index('user_branch_roles_branch_id_idx').on(table.branchId),
    index('user_branch_roles_role_id_idx').on(table.roleId),
    index('user_branch_roles_organization_id_idx').on(table.organizationId),
  ],
);

/** Organization-scoped role grants are intentionally separate from branch
 * grants. They are the only source of authority for organization-wide actions.
 */
export const userOrganizationRoles = identitySchema.table(
  'user_organization_roles',
  {
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id').notNull(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'user_organization_roles_pk', columns: [table.userId, table.roleId] }),
    foreignKey({
      name: 'user_organization_roles_user_tenant_fk',
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'user_organization_roles_role_tenant_fk',
      columns: [table.roleId, table.organizationId],
      foreignColumns: [roles.id, roles.organizationId],
    }).onDelete('cascade'),
    index('user_organization_roles_role_id_idx').on(table.roleId),
    index('user_organization_roles_organization_id_idx').on(table.organizationId),
  ],
);

/**
 * Immutable provisioning claim: one row per organization proves which User
 * received the initial Owner role. Its primary key is the durable concurrency
 * barrier; it intentionally does not constrain later normal role grants.
 */
export const initialOwnerAssignments = identitySchema.table(
  'initial_owner_assignments',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'initial_owner_assignments_user_tenant_fk',
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'initial_owner_assignments_role_tenant_fk',
      columns: [table.roleId, table.organizationId],
      foreignColumns: [roles.id, roles.organizationId],
    }).onDelete('cascade'),
    index('initial_owner_assignments_user_id_idx').on(table.userId),
    index('initial_owner_assignments_role_id_idx').on(table.roleId),
  ],
);

// ---------------------------------------------------------------------------
// Explicit branch access (with or without roles)
// ---------------------------------------------------------------------------

/**
 * The explicit branch-access list. DECISION (docs/architecture/
 * 11-identity-access.md + 72-authorization-matrix.md): holding any role on a
 * branch IMPLIES access to that branch — assigning a role inserts a matching
 * row here — while this table also stores access WITHOUT any role (e.g.
 * view-only staff who must see a branch but hold no capability). Effective
 * branch scope is therefore: branch_access ∪ user_branch_roles branches.
 *
 * Removing access requires revoking the holder's roles at that branch first;
 * the User aggregate refuses to strand a role without access.
 */
export const branchAccess = identitySchema.table(
  'branch_access',
  {
    userId: uuid('user_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'branch_access_pk', columns: [table.userId, table.branchId] }),
    foreignKey({
      name: 'branch_access_user_tenant_fk',
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'branch_access_branch_tenant_fk',
      columns: [table.branchId, table.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }).onDelete('cascade'),
    index('branch_access_branch_id_idx').on(table.branchId),
    index('branch_access_organization_id_idx').on(table.organizationId),
  ],
);
