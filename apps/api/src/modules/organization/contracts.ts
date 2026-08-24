import type { PolicyType, PolicyValue } from '@commerce-platform/database';

/**
 * Public module contract of the Organization context
 * (docs/architecture/60-module-contracts.md "Organization").
 *
 * Other bounded contexts consume these queries through the
 * {@link ORGANIZATION_CONTRACTS} injection token — never through this
 * module's repositories or tables. The contract is read-only and every query
 * is organizationId-scoped (Layer 2 tenant isolation).
 */

/** Nest injection token binding the Organization context's contract provider. */
export const ORGANIZATION_CONTRACTS = Symbol('ORGANIZATION_CONTRACTS');

export { POLICY_TYPES as ORGANIZATION_POLICY_TYPES } from '@commerce-platform/database';
export type { PolicyType as OrganizationPolicyType, PolicyValue as OrganizationPolicyValue };

/** Branch projection exposed to other contexts. */
export interface OrganizationBranchView {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  /** Fulfillment priority controlled by the organization (higher wins first). */
  priority: number;
  isActive: boolean;
  version: number;
}

/** Warehouse projection exposed to other contexts. */
export interface OrganizationWarehouseView {
  id: string;
  organizationId: string;
  branchId: string;
  code: string;
  name: string;
  isActive: boolean;
  version: number;
}

/** Where a policy answer came from. */
export type OrganizationPolicySource =
  | 'stored' // explicit SetPolicy history entry exists
  | 'default'; // provisional M1 fallback (see domain/policy.ts)

export interface OrganizationPolicyView {
  organizationId: string;
  policyType: PolicyType;
  value: PolicyValue;
  /**
   * Persisted policy version when source='stored'; 0 for defaults (defaults
   * are not part of the versioned history).
   */
  version: number;
  source: OrganizationPolicySource;
}

/**
 * Queries provided by the Organization bounded context.
 */
export interface OrganizationContracts {
  /** Latest stored policy for the organization or the documented default. */
  getOrganizationPolicy(
    organizationId: string,
    policyType: PolicyType,
  ): Promise<OrganizationPolicyView>;

  /** One branch of the organization, or null when it does not exist. */
  getBranch(organizationId: string, branchId: string): Promise<OrganizationBranchView | null>;

  /** One warehouse of the organization, or null when it does not exist. */
  getWarehouse(
    organizationId: string,
    warehouseId: string,
  ): Promise<OrganizationWarehouseView | null>;

  /**
   * Fulfillment priority of one branch of the organization.
   * Throws RESOURCE_NOT_FOUND when the branch does not belong to the
   * organization.
   */
  getBranchPriority(organizationId: string, branchId: string): Promise<number>;
}
