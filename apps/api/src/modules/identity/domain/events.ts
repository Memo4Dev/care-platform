import type { PermissionCode } from '@commerce-platform/database';

/**
 * Domain events of the Identity & Access context (docs/architecture/
 * 11-identity-access.md). Every mutable command emits a typed fact so its
 * mandatory human actor and trace provenance can be retained in the outbox.
 *
 * Events are plain data collected inside aggregates and persisted to the
 * integration outbox within the same transaction as the state change.
 * Serialization is JSON; keep payloads free of functions, class instances and
 * sensitive data. The infrastructure envelope serializes IDs and capability
 * codes only; no password, auth-secret, email, name, or role label appears in
 * an integration payload.
 */

export interface UserCreatedEvent {
  readonly type: 'UserCreated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly userId: string;
  /** Normalized (lowercase) email — global login handle via Supabase Auth. */
  readonly email: string;
  readonly name: string;
  readonly status: 'ACTIVE';
}

export interface UserRoleAssignedEvent {
  readonly type: 'UserRoleAssigned';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly userId: string;
  readonly roleId: string;
  readonly branchId: string;
}

export interface UserIdentityLinkedEvent {
  readonly type: 'UserIdentityLinked';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly userId: string;
}

export interface UserSuspendedEvent {
  readonly type: 'UserSuspended';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly userId: string;
}

export interface UserReactivatedEvent {
  readonly type: 'UserReactivated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly userId: string;
}

export interface UserRoleRevokedEvent {
  readonly type: 'UserRoleRevoked';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly userId: string;
  readonly roleId: string;
  readonly branchId: string;
}

export interface BranchAccessGrantedEvent {
  readonly type: 'BranchAccessGranted';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly userId: string;
  readonly branchId: string;
}

export interface BranchAccessRevokedEvent {
  readonly type: 'BranchAccessRevoked';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly userId: string;
  readonly branchId: string;
}

export interface RoleCreatedEvent {
  readonly type: 'RoleCreated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly roleId: string;
  readonly code: string;
  readonly name: string;
  /** True for seeded templates (Owner/Manager/...); false for custom roles. */
  readonly isSystem: boolean;
}

/** Replace-set semantics: payload carries the FULL new permission set. */
export interface RolePermissionsChangedEvent {
  readonly type: 'RolePermissionsChanged';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly roleId: string;
  readonly permissionCodes: readonly PermissionCode[];
}

export type IdentityUserDomainEvent =
  | UserCreatedEvent
  | UserIdentityLinkedEvent
  | UserSuspendedEvent
  | UserReactivatedEvent
  | UserRoleAssignedEvent
  | UserRoleRevokedEvent
  | BranchAccessGrantedEvent
  | BranchAccessRevokedEvent;

export interface RoleRenamedEvent {
  readonly type: 'RoleRenamed';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly roleId: string;
}

export type IdentityRoleDomainEvent =
  RoleCreatedEvent | RoleRenamedEvent | RolePermissionsChangedEvent;

/** Stable aggregate family names used in integration outbox rows. */
export const IDENTITY_USER_AGGREGATE_TYPE = 'IdentityUser' as const;
export const IDENTITY_ROLE_AGGREGATE_TYPE = 'IdentityRole' as const;
