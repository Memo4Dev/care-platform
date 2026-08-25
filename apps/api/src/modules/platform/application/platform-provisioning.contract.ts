export const PLATFORM_PROVISIONING = Symbol('PLATFORM_PROVISIONING');
/** Reserved exclusively for the future idempotent Tenant Provisioning process manager. */
import type { SystemServicePrincipal } from '../../../common/auth/authenticated-principal';
export interface PlatformProvisioningContract {
  markProvisioningCompleted(input: {
    principal: SystemServicePrincipal;
    tenantId: string;
    correlationId: string;
    causationId: string;
  }): Promise<void>;
}
