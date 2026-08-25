import { Module } from '@nestjs/common';
import { PlatformError } from '@commerce-platform/contracts';
import { randomUUID } from 'node:crypto';
import type { VerifiedTenantRegistrationSnapshot } from '../../modules/platform/application/platform-provisioning.contract';

export const PROVISIONING_EXECUTION_ISSUER = Symbol('PROVISIONING_EXECUTION_ISSUER');
export const PROVISIONING_EXECUTION_VERIFIER = Symbol('PROVISIONING_EXECUTION_VERIFIER');

export interface ProvisioningExecutionScope {
  readonly __provisioningExecutionScope: unique symbol;
}

interface ScopeState {
  tenantId: string;
  provisioningId: string;
  executionId: string;
  organizationId: string;
  registrationReference: string;
  owner: { supabaseSubject: string; email: string; displayName: string };
  correlationId: string;
  causationId: string;
  expiresAt: number;
  terminal: boolean;
}

type ScopeExpectation = Pick<
  ScopeState,
  | 'tenantId'
  | 'provisioningId'
  | 'organizationId'
  | 'registrationReference'
  | 'correlationId'
  | 'causationId'
>;

export interface TrustedProvisioningExecutionIssuer {
  startFromVerifiedRegistration(input: {
    registration: VerifiedTenantRegistrationSnapshot;
    provisioningId: string;
    correlationId: string;
    causationId: string;
    expiresAt: number;
  }): ProvisioningExecutionScope;
}

export interface ProvisioningExecutionVerifier {
  verify(value: unknown, expected?: Partial<ScopeExpectation>): Readonly<ScopeState>;
  invalidate(value: unknown): void;
}

class OpaqueProvisioningExecutionScope {
  toJSON(): never {
    throw new TypeError('Provisioning execution capabilities are not serializable.');
  }
}

/** Not exported: Nest can only supply this private implementation through its ports. */
class ProvisioningExecutionRegistry
  implements TrustedProvisioningExecutionIssuer, ProvisioningExecutionVerifier
{
  private readonly issued = new WeakMap<object, ScopeState>();

  startFromVerifiedRegistration(input: {
    registration: VerifiedTenantRegistrationSnapshot;
    provisioningId: string;
    correlationId: string;
    causationId: string;
    expiresAt: number;
  }): ProvisioningExecutionScope {
    const capability = Object.freeze(new OpaqueProvisioningExecutionScope());
    this.issued.set(capability, {
      tenantId: input.registration.tenantId,
      provisioningId: input.provisioningId,
      executionId: randomUUID(),
      organizationId: input.registration.organizationId,
      registrationReference: input.registration.reference,
      owner: input.registration.owner,
      correlationId: input.correlationId,
      causationId: input.causationId,
      expiresAt: input.expiresAt,
      terminal: false,
    });
    return capability as unknown as ProvisioningExecutionScope;
  }

  verify(value: unknown, expected?: Partial<ScopeExpectation>): Readonly<ScopeState> {
    const state = typeof value === 'object' && value ? this.issued.get(value) : undefined;
    if (
      !state ||
      state.terminal ||
      state.expiresAt <= Date.now() ||
      (expected &&
        Object.entries(expected).some(
          ([key, candidate]) => state[key as keyof ScopeState] !== candidate,
        ))
    )
      throw PlatformError.permissionDenied(
        'A current tenant provisioning execution capability is required.',
      );
    return state;
  }

  invalidate(value: unknown) {
    const state = typeof value === 'object' && value ? this.issued.get(value) : undefined;
    if (state) state.terminal = true;
  }
}

@Module({
  providers: [
    ProvisioningExecutionRegistry,
    { provide: PROVISIONING_EXECUTION_ISSUER, useExisting: ProvisioningExecutionRegistry },
    { provide: PROVISIONING_EXECUTION_VERIFIER, useExisting: ProvisioningExecutionRegistry },
  ],
  exports: [PROVISIONING_EXECUTION_ISSUER, PROVISIONING_EXECUTION_VERIFIER],
})
export class ProvisioningExecutionModule {}
