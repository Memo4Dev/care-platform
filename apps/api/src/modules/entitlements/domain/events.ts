import type { EntitlementValue } from '@commerce-platform/database';

export interface PlanCreatedEvent {
  type: 'PlanCreated';
  occurredAt: Date;
  planId: string;
  code: string;
}
export interface PlanUpdatedEvent {
  type: 'PlanUpdated';
  occurredAt: Date;
  planId: string;
}
export interface PlanActivatedEvent {
  type: 'PlanActivated';
  occurredAt: Date;
  planId: string;
}
export interface PlanEntitlementChangedEvent {
  type: 'PlanEntitlementChanged';
  occurredAt: Date;
  planId: string;
  code: string;
  value: EntitlementValue;
}
export interface TenantEntitlementOverrideGrantedEvent {
  type: 'TenantEntitlementOverrideGranted';
  occurredAt: Date;
  overrideId: string;
  organizationId: string;
  code: string;
}
export interface TenantEntitlementOverrideRevokedEvent {
  type: 'TenantEntitlementOverrideRevoked';
  occurredAt: Date;
  overrideId: string;
  organizationId: string;
  code: string;
}
export type PlanDomainEvent =
  PlanCreatedEvent | PlanUpdatedEvent | PlanActivatedEvent | PlanEntitlementChangedEvent;
export type OverrideDomainEvent =
  TenantEntitlementOverrideGrantedEvent | TenantEntitlementOverrideRevokedEvent;
export const PLAN_AGGREGATE_TYPE = 'Plan' as const;
export const TENANT_OVERRIDE_AGGREGATE_TYPE = 'TenantEntitlementOverride' as const;
