import { Inject, Injectable } from '@nestjs/common';
import type { OrganizationProvisioningContracts } from '../contracts';
import { DEFAULT_POLICY_VALUES } from '../domain/policy';
import { OrganizationContractProvider } from './organization-contracts.provider';
import { OrganizationService } from './organization.service';

/** Trusted bootstrap facade. Commands remain owned and persisted by Organization. */
@Injectable()
export class OrganizationProvisioningService implements OrganizationProvisioningContracts {
  constructor(
    @Inject(OrganizationService) private readonly commands: OrganizationService,
    @Inject(OrganizationContractProvider) private readonly queries: OrganizationContractProvider,
  ) {}

  async provisionBusinessDefaults(input: {
    organizationId: string;
    branchId: string;
    warehouseId: string;
    correlationId: string;
    causationId: string;
  }): Promise<void> {
    if (!(await this.queries.getBranch(input.organizationId, input.branchId))) {
      await this.commands.createBranch({
        organizationId: input.organizationId,
        branchId: input.branchId,
        code: 'DEFAULT',
        name: 'Default branch',
        priority: 0,
      });
    }
    if (!(await this.queries.getWarehouse(input.organizationId, input.warehouseId))) {
      await this.commands.createWarehouse({
        organizationId: input.organizationId,
        warehouseId: input.warehouseId,
        branchId: input.branchId,
        code: 'DEFAULT',
        name: 'Default warehouse',
      });
    }
    for (const policyType of Object.keys(DEFAULT_POLICY_VALUES) as Array<
      keyof typeof DEFAULT_POLICY_VALUES
    >) {
      const policy = await this.queries.getOrganizationPolicy(input.organizationId, policyType);
      if (policy.source === 'default')
        await this.commands.setPolicy({
          organizationId: input.organizationId,
          policyType,
          value: policy.value,
        });
    }
  }
}
