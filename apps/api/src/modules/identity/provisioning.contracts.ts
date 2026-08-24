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
}
