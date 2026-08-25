import { Inject, Injectable } from '@nestjs/common';
import type { DatabaseClient } from '@commerce-platform/database';
import { PlatformError } from '@commerce-platform/contracts';
import { DATABASE } from '../../database/database.tokens';
import type { PlatformProvisioningContract } from './platform-provisioning.contract';
import { PlatformTenantRepository } from '../infrastructure/platform-tenant.repository';
import type { DbExecutor } from '../infrastructure/db-executor';
import type { VerifiedTenantRegistrationSnapshot } from './platform-provisioning.contract';
import {
  PROVISIONING_EXECUTION_VERIFIER,
  type ProvisioningExecutionScope,
  type ProvisioningExecutionVerifier,
} from '../../../common/provisioning-execution/provisioning-execution.module';
import { tenantProvisioning } from '@commerce-platform/database';
import { and, eq } from 'drizzle-orm';

const MANDATORY_PROVISIONING_STEPS = [
  'CreatingOrganization',
  'CreatingIdentityDefaults',
  'CreatingBusinessDefaults',
  'CreatingStorefront',
] as const;

@Injectable()
export class PlatformProvisioningService implements PlatformProvisioningContract {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(PlatformTenantRepository) private readonly repository: PlatformTenantRepository,
    @Inject(PROVISIONING_EXECUTION_VERIFIER)
    private readonly execution: ProvisioningExecutionVerifier,
  ) {}
  async getVerifiedRegistration(reference: string): Promise<VerifiedTenantRegistrationSnapshot> {
    const snapshot = await this.repository.findVerifiedRegistration(this.db, reference);
    if (!snapshot)
      throw PlatformError.permissionDenied('Verified tenant registration is required.');
    return snapshot;
  }
  async markProvisioningCompleted(
    executor: DbExecutor,
    capability: ProvisioningExecutionScope,
  ): Promise<void> {
    const input = this.execution.verify(capability);
    const [process] = await executor
      .select({
        id: tenantProvisioning.id,
        organizationId: tenantProvisioning.organizationId,
        status: tenantProvisioning.status,
        checkpoints: tenantProvisioning.checkpointsJson,
      })
      .from(tenantProvisioning)
      .where(
        and(
          eq(tenantProvisioning.id, input.provisioningId),
          eq(tenantProvisioning.tenantId, input.tenantId),
          eq(tenantProvisioning.organizationId, input.organizationId),
        ),
      );
    if (
      !process ||
      process.status !== 'CREATING_STOREFRONT' ||
      !MANDATORY_PROVISIONING_STEPS.every((step) => Boolean(process.checkpoints[step]))
    )
      throw PlatformError.permissionDenied('Mandatory provisioning checkpoints are not persisted.');
    const registration = await this.repository.findVerifiedRegistration(
      executor,
      input.registrationReference,
    );
    if (
      !registration ||
      registration.tenantId !== input.tenantId ||
      registration.organizationId !== input.organizationId
    )
      throw PlatformError.permissionDenied(
        'Provisioning execution scope does not match registration.',
      );
    const tenant = await this.repository.find(executor, input.tenantId);
    if (!tenant) throw PlatformError.notFound(`Platform tenant ${input.tenantId} was not found.`);
    if (tenant.organizationId !== input.organizationId)
      throw PlatformError.permissionDenied('Provisioning execution scope does not match tenant.');
    if (tenant.provisioningStatus === 'COMPLETED') return;
    tenant.completeProvisioning();
    await this.repository.save(executor, tenant, {
      actorId: 'SYSTEM:tenant-provisioning',
      correlationId: input.correlationId,
      causationId: input.causationId,
    });
  }
}
