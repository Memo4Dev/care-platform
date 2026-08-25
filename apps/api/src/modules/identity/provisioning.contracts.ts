import type { IdentityUserCommandResult } from './application/identity.service';

/** Dedicated trusted boundary consumed only by Tenant Provisioning. */
export const IDENTITY_PROVISIONING = Symbol('IDENTITY_PROVISIONING');

export interface IdentityProvisioningContracts {
  provisionInitialOwner(command: {
    organizationId: string;
    email: string;
    name: string;
    userId?: string;
    supabaseUserId?: string;
    correlationId: string;
    causationId: string;
  }): Promise<IdentityUserCommandResult>;
  /** Grant the bootstrap Owner access to the deterministic default branch. */
  grantInitialOwnerBranchAccess(input: {
    organizationId: string;
    userId: string;
    branchId: string;
    correlationId: string;
    causationId: string;
  }): Promise<void>;
}
