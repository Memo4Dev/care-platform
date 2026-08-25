import type {
  PlatformTenantStatus,
  ProvisioningStatus,
  SupportSessionStatus,
} from '@commerce-platform/database';

export const PLATFORM_TENANT_AGGREGATE_TYPE = 'PlatformTenant' as const;
export type PlatformTenantEventType =
  | 'TenantRegistered'
  | 'TenantActivated'
  | 'TenantSuspended'
  | 'TenantReactivated'
  | 'TenantClosed'
  | 'SupportAccessRequested'
  | 'SupportAccessStarted'
  | 'SupportAccessEnded';
export interface PlatformTenantDomainEvent {
  type: PlatformTenantEventType;
  occurredAt: Date;
  tenantId: string;
  organizationId: string;
  status: PlatformTenantStatus;
  provisioningStatus: ProvisioningStatus;
  supportSessionId?: string;
  supportStatus?: SupportSessionStatus;
  supportReason?: string;
}
