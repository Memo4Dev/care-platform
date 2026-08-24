import type { PolicyType, PolicyValue } from './policy';

/**
 * Domain events of the Organization context (docs/architecture/
 * 10-organization.md "Key events" plus lifecycle transitions).
 *
 * Events are plain data: they are collected inside aggregates and persisted to
 * the integration outbox by the repository within the same transaction as the
 * state change. Serialization is JSON; keep payloads free of functions,
 * class instances and sensitive data.
 */

/** Lifecycle status of an organization aggregate (mirrors the DB enum). */
export type OrganizationStatus = 'ACTIVE' | 'SUSPENDED';

export interface OrganizationCreatedEvent {
  readonly type: 'OrganizationCreated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly name: string;
  /** Status right after creation (ACTIVE for M1 provisioning simplicity). */
  readonly status: Extract<OrganizationStatus, 'ACTIVE'>;
}

export interface OrganizationActivatedEvent {
  readonly type: 'OrganizationActivated';
  readonly occurredAt: Date;
  readonly organizationId: string;
}

export interface OrganizationSuspendedEvent {
  readonly type: 'OrganizationSuspended';
  readonly occurredAt: Date;
  readonly organizationId: string;
}

export interface BranchCreatedEvent {
  readonly type: 'BranchCreated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly branchId: string;
  readonly code: string;
  readonly name: string;
  readonly priority: number;
}

export interface BranchPriorityChangedEvent {
  readonly type: 'BranchPriorityChanged';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly branchId: string;
  readonly priority: number;
}

export interface WarehouseCreatedEvent {
  readonly type: 'WarehouseCreated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly warehouseId: string;
  readonly branchId: string;
  readonly code: string;
  readonly name: string;
}

export interface WarehouseDeactivatedEvent {
  readonly type: 'WarehouseDeactivated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly warehouseId: string;
  readonly branchId: string;
}

export interface OrganizationPolicyChangedEvent {
  readonly type: 'OrganizationPolicyChanged';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly policyType: PolicyType;
  readonly value: PolicyValue;
  /** Per-organization monotonic policy version assigned to this change. */
  readonly policyVersion: number;
}

export type OrganizationDomainEvent =
  | OrganizationCreatedEvent
  | OrganizationActivatedEvent
  | OrganizationSuspendedEvent
  | BranchCreatedEvent
  | BranchPriorityChangedEvent
  | WarehouseCreatedEvent
  | WarehouseDeactivatedEvent
  | OrganizationPolicyChangedEvent;

/** Stable aggregate family name used in the integration outbox rows. */
export const ORGANIZATION_AGGREGATE_TYPE = 'Organization' as const;
