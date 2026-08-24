import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import {
  branches,
  organizationPolicies,
  warehouses,
  type DatabaseClient,
  type PolicyType,
} from '@commerce-platform/database';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { DATABASE } from '../../database/database.tokens';
import {
  OrganizationBranchView,
  OrganizationContracts,
  OrganizationPolicySource,
  OrganizationPolicyView,
  OrganizationWarehouseView,
} from '../contracts';
import { DEFAULT_POLICY_VALUES, isPolicyType } from '../domain/policy';

/**
 * Read-model implementation of the Organization module contract.
 *
 * Deliberately queries projections directly (SELECT-only) instead of loading
 * aggregates: contract reads must stay cheap for hot paths such as POS
 * bootstrap and pricing. All access is organizationId-scoped.
 */
@Injectable()
export class OrganizationContractProvider implements OrganizationContracts {
  constructor(@Inject(DATABASE) private readonly db: DatabaseClient) {}

  async getOrganizationPolicy(
    organizationId: string,
    policyType: PolicyType,
  ): Promise<OrganizationPolicyView> {
    if (!isPolicyType(policyType)) {
      throw PlatformError.validationFailed(
        `Unknown organization policy type "${String(policyType)}".`,
        { details: { field: 'policyType' } },
      );
    }

    const [row] = await this.db
      .select({
        valueJson: organizationPolicies.valueJson,
        version: organizationPolicies.version,
      })
      .from(organizationPolicies)
      .where(
        and(
          eq(organizationPolicies.organizationId, organizationId),
          eq(organizationPolicies.policyType, policyType),
        ),
      )
      .orderBy(desc(organizationPolicies.version))
      .limit(1);

    if (row) {
      return {
        organizationId,
        policyType,
        value: row.valueJson,
        version: row.version,
        source: 'stored' satisfies OrganizationPolicySource,
      };
    }

    return {
      organizationId,
      policyType,
      value: DEFAULT_POLICY_VALUES[policyType],
      version: 0,
      source: 'default' satisfies OrganizationPolicySource,
    };
  }

  async getBranch(
    organizationId: string,
    branchId: string,
  ): Promise<OrganizationBranchView | null> {
    const [row] = await this.db
      .select()
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.organizationId, organizationId)))
      .limit(1);

    return row ? toBranchView(row) : null;
  }

  async getWarehouse(
    organizationId: string,
    warehouseId: string,
  ): Promise<OrganizationWarehouseView | null> {
    const [row] = await this.db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, warehouseId), eq(warehouses.organizationId, organizationId)))
      .limit(1);

    return row ? toWarehouseView(row) : null;
  }

  async getBranchPriority(organizationId: string, branchId: string): Promise<number> {
    const [row] = await this.db
      .select({ priority: branches.priority })
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.organizationId, organizationId)))
      .limit(1);

    if (!row) {
      throw PlatformError.of(
        ERROR_CODES.RESOURCE_NOT_FOUND,
        `Branch ${branchId} does not belong to organization ${organizationId}.`,
        { details: { branchId, organizationId } },
      );
    }

    return row.priority;
  }
}

interface BranchRow {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  priority: number;
  isActive: boolean;
  version: number;
}

interface WarehouseRow {
  id: string;
  organizationId: string;
  branchId: string;
  code: string;
  name: string;
  isActive: boolean;
  version: number;
}

function toBranchView(row: BranchRow): OrganizationBranchView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    priority: row.priority,
    isActive: row.isActive,
    version: row.version,
  };
}

function toWarehouseView(row: WarehouseRow): OrganizationWarehouseView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    branchId: row.branchId,
    code: row.code,
    name: row.name,
    isActive: row.isActive,
    version: row.version,
  };
}
