import { Inject, Injectable } from '@nestjs/common';
import type { DatabaseClient } from '@commerce-platform/database';
import { PlatformError } from '@commerce-platform/contracts';
import { DATABASE } from '../../database/database.tokens';
import type { PlatformProvisioningContract } from './platform-provisioning.contract';
import { PlatformTenantRepository } from '../infrastructure/platform-tenant.repository';
import { assertTrustedPrincipal } from './authenticated-principal.provider';

@Injectable()
export class PlatformProvisioningService implements PlatformProvisioningContract {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly repository: PlatformTenantRepository,
  ) {}
  async markProvisioningCompleted(input: {
    principal: import('../../../common/auth/authenticated-principal').SystemServicePrincipal;
    tenantId: string;
    correlationId: string;
    causationId: string;
  }): Promise<void> {
    if (
      (() => {
        try {
          assertTrustedPrincipal(input.principal);
          return false;
        } catch {
          return true;
        }
      })() ||
      input.principal.type !== 'SYSTEM_SERVICE' ||
      input.principal.subjectId !== 'SYSTEM:tenant-provisioning'
    )
      throw PlatformError.permissionDenied('Provisioning system principal required.');
    await this.db.transaction(async (tx) => {
      const tenant = await this.repository.find(tx, input.tenantId);
      if (!tenant) throw PlatformError.notFound(`Platform tenant ${input.tenantId} was not found.`);
      if (tenant.provisioningStatus === 'COMPLETED') return;
      tenant.completeProvisioning();
      await this.repository.save(tx, tenant, {
        actorId: input.principal.subjectId,
        correlationId: input.correlationId,
        causationId: input.causationId,
      });
    });
  }
}
