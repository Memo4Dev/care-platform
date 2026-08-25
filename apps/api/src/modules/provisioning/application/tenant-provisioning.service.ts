import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { newId, type DatabaseClient } from '@commerce-platform/database';
import { sql } from 'drizzle-orm';
import { DATABASE } from '../../database/database.tokens';
import {
  PROVISIONING_EXECUTION_ISSUER,
  PROVISIONING_EXECUTION_VERIFIER,
  type ProvisioningExecutionScope,
  type ProvisioningExecutionVerifier,
  type TrustedProvisioningExecutionIssuer,
} from '../../../common/provisioning-execution/provisioning-execution.module';
import { ENTITLEMENT_SERVICE, type EntitlementServiceContract } from '../../entitlements/contracts';
import {
  IDENTITY_PROVISIONING,
  type IdentityProvisioningContracts,
} from '../../identity/provisioning.contracts';
import {
  ORGANIZATION_PROVISIONING,
  type OrganizationProvisioningContracts,
} from '../../organization/contracts';
import {
  PLATFORM_PROVISIONING,
  type PlatformProvisioningContract,
} from '../../platform/application/platform-provisioning.contract';
import { TenantProvisioningRepository } from '../infrastructure/tenant-provisioning.repository';
import {
  PROVISIONING_STEPS,
  type ProvisioningStep,
  type TenantProvisioning,
} from '../domain/tenant-provisioning';

/**
 * Resumable process manager. Its only caller-controlled value is an opaque
 * registration reference; all tenant, organization and owner identity is read
 * from Platform's persisted verified registration snapshot.
 */
@Injectable()
export class TenantProvisioningService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(TenantProvisioningRepository)
    private readonly repository: TenantProvisioningRepository,
    @Inject(ORGANIZATION_PROVISIONING)
    private readonly organization: OrganizationProvisioningContracts,
    @Inject(IDENTITY_PROVISIONING) private readonly identity: IdentityProvisioningContracts,
    @Inject(ENTITLEMENT_SERVICE)
    private readonly entitlements: EntitlementServiceContract,
    @Inject(PLATFORM_PROVISIONING) private readonly platform: PlatformProvisioningContract,
    @Inject(PROVISIONING_EXECUTION_ISSUER)
    private readonly executionIssuer: TrustedProvisioningExecutionIssuer,
    @Inject(PROVISIONING_EXECUTION_VERIFIER)
    private readonly execution: ProvisioningExecutionVerifier,
  ) {}

  async start(input: ProvisioningRequest) {
    return this.run(input);
  }

  async retry(input: ProvisioningRequest) {
    return this.run(input);
  }

  private async run(input: ProvisioningRequest) {
    const registration = await this.platform.getVerifiedRegistration(input.registrationReference);
    await this.ensureProcess(registration.tenantId, registration.organizationId);
    try {
      return await this.db.transaction(async (tx) => {
        // The lock is retained while side-effect contracts execute. Those calls
        // are idempotent; a crash can lose a checkpoint but can never duplicate
        // their deterministic defaults.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${registration.tenantId}, 8))`,
        );
        let record = await this.repository.find(tx, registration.tenantId);
        if (!record) throw new Error('Tenant provisioning process was not persisted.');
        if (record.organizationId !== registration.organizationId) {
          throw new Error(
            'Tenant provisioning registration scope does not match its durable process.',
          );
        }
        if (record.status === 'COMPLETED') return snapshot(record);

        const capability = this.executionIssuer.startFromVerifiedRegistration({
          registration,
          provisioningId: record.id,
          correlationId: input.correlationId,
          causationId: input.causationId,
          expiresAt: Date.now() + 60_000,
        });
        try {
          for (const step of PROVISIONING_STEPS) {
            record = (await this.repository.find(tx, registration.tenantId))!;
            if (record.isComplete(step)) continue;
            record.begin(step);
            await this.persist(
              tx,
              record,
              step === 'CreatingOrganization' ? 'TenantProvisioningStarted' : `${step}Started`,
              input,
            );
            record = (await this.repository.find(tx, registration.tenantId))!;
            await this.executeStep(capability, record, step);
            record.checkpoint(step, step === 'CreatingStorefront');
            await this.persist(
              tx,
              record,
              step === 'CreatingStorefront'
                ? 'StorefrontProvisioned'
                : `${step.replace('Creating', '')}Provisioned`,
              input,
            );
          }
          record = (await this.repository.find(tx, registration.tenantId))!;
          await this.platform.markProvisioningCompleted(tx, capability);
          record.complete();
          await this.persist(tx, record, 'TenantProvisioningCompleted', input);
          this.execution.invalidate(capability);
          return snapshot(record);
        } finally {
          this.execution.invalidate(capability);
        }
      });
    } catch (error) {
      // Do not ever change terminal state to failure. A concurrent completion
      // wins monotonically; a failed non-terminal run remains traceable.
      await this.recordFailure(registration.tenantId, input, error);
      throw error;
    }
  }

  private async ensureProcess(tenantId: string, organizationId: string) {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${tenantId}, 8))`);
      const existing = await this.repository.find(tx, tenantId);
      if (existing) {
        if (existing.organizationId !== organizationId)
          throw new Error(
            'Tenant provisioning registration scope does not match its durable process.',
          );
        return;
      }
      await this.repository.create(tx, { id: newId(), tenantId, organizationId });
    });
  }

  private async executeStep(
    capability: ProvisioningExecutionScope,
    record: TenantProvisioning,
    step: ProvisioningStep,
  ) {
    const scope = this.execution.verify(capability, {
      tenantId: record.tenantId,
      provisioningId: record.id,
      organizationId: record.organizationId,
    });
    if (step === 'CreatingOrganization') return;
    if (step === 'CreatingIdentityDefaults') {
      await this.identity.provisionInitialOwner({
        organizationId: scope.organizationId,
        email: scope.owner.email,
        name: scope.owner.displayName,
        userId: stableId(scope.tenantId, 'owner'),
        supabaseUserId: scope.owner.supabaseSubject,
        correlationId: scope.correlationId,
        causationId: scope.causationId,
      });
      return;
    }
    if (step === 'CreatingBusinessDefaults') {
      await this.organization.provisionBusinessDefaults({
        organizationId: scope.organizationId,
        branchId: stableId(scope.tenantId, 'branch'),
        warehouseId: stableId(scope.tenantId, 'warehouse'),
        correlationId: scope.correlationId,
        causationId: scope.causationId,
      });
      return;
    }
    await this.entitlements.canUseFeature(scope.organizationId, 'storefront.enabled');
  }

  private async recordFailure(tenantId: string, input: ProvisioningRequest, error: unknown) {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${tenantId}, 8))`);
      const record = await this.repository.find(tx, tenantId);
      if (!record || record.status === 'COMPLETED') return;
      record.fail(error);
      await this.persist(tx, record, 'TenantProvisioningFailed', input);
    });
  }

  private persist(
    tx: Parameters<TenantProvisioningRepository['save']>[0],
    record: TenantProvisioning,
    event: string,
    input: ProvisioningRequest,
  ) {
    return this.repository.save(tx, record, event, {
      actorId: 'SYSTEM:tenant-provisioning',
      correlationId: input.correlationId,
      causationId: input.causationId,
    });
  }
}

export interface ProvisioningRequest {
  registrationReference: string;
  correlationId: string;
  causationId: string;
}

function stableId(seed: string, purpose: string) {
  const hex = createHash('sha256').update(`${seed}:${purpose}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function snapshot(record: TenantProvisioning) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
    status: record.status,
    currentStep: record.currentStep,
    checkpoints: record.checkpoints,
    version: record.version,
  };
}
