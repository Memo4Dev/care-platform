/**
 * A registration source is trusted application infrastructure (for example a
 * verified signup resolver), never an HTTP DTO. Its result is retained on the
 * Platform Tenant as the immutable authority for provisioning.
 */
export interface TrustedRegistrationSnapshot {
  reference: string;
  organizationId: string;
  requestedOrganizationName: string;
  owner: { supabaseSubject: string; email: string; displayName: string };
  verifiedAt: Date;
}

export interface PlatformRegistrationResolver {
  resolveTrustedRegistration(reference: string): Promise<TrustedRegistrationSnapshot>;
}

export const PLATFORM_REGISTRATION_RESOLVER = Symbol('PLATFORM_REGISTRATION_RESOLVER');

/** Deliberately fails closed until a verified signup/registration adapter is installed. */
export class UnavailablePlatformRegistrationResolver implements PlatformRegistrationResolver {
  async resolveTrustedRegistration(): Promise<never> {
    throw new Error('No trusted Platform registration resolver is configured.');
  }
}
