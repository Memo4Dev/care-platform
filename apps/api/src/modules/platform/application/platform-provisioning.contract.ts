import type { DbExecutor } from '../infrastructure/db-executor';
import type { ProvisioningExecutionScope } from '../../../common/provisioning-execution/provisioning-execution.module';

export const PLATFORM_PROVISIONING = Symbol('PLATFORM_PROVISIONING');
/** Reserved exclusively for the Tenant Provisioning process manager. */
export interface VerifiedTenantRegistrationSnapshot {
  tenantId: string;
  organizationId: string;
  reference: string;
  requestedOrganizationName: string;
  owner: { supabaseSubject: string; email: string; displayName: string };
  verifiedAt: Date;
}
export interface PlatformProvisioningContract {
  getVerifiedRegistration(reference: string): Promise<VerifiedTenantRegistrationSnapshot>;
  markProvisioningCompleted(
    executor: DbExecutor,
    capability: ProvisioningExecutionScope,
  ): Promise<void>;
}
