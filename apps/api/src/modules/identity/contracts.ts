import type { AuthorizationDecision } from './domain/authorization/authorize';

/**
 * Public module contract of the Identity & Access context
 * (docs/architecture/60-module-contracts.md "Identity & Access").
 *
 * Other bounded contexts consume these operations through the
 * {@link IDENTITY_CONTRACTS} injection token — never through this module's
 * repositories or tables. The contract surface for M1 is exactly:
 *
 * - Authorize(action, organization, branch?) -> authorize()
 * - GetEffectivePermissions                   -> getEffectivePermissions()
 *
 * ValidatePOSDevice (the third listed contract operation) is deliberately NOT
 * part of this token yet: POS device identities arrive with M8 and inventing
 * a stub behavior now would fake a decision that belongs to that milestone.
 * Extend this interface additively when M8 lands.
 */

/** Nest injection token binding the Identity context's contract provider. */
export const IDENTITY_CONTRACTS = Symbol('IDENTITY_CONTRACTS');

export type { AuthorizationDecision } from './domain/authorization/authorize';
export type { AuthorizationDenyReason } from './domain/authorization/authorize';

/** Command shape of Authorize(action, organization, branch?, resource?). */
export interface AuthorizeCommand {
  /** Subject user id (resolved from authenticated context by callers). */
  userId: string;
  /** Tenant scope — never trusted from request bodies without authorization. */
  organizationId: string;
  /** Capability being requested, e.g. `sales.create`. */
  permissionCode: string;
  /**
   * Target branch when the action is branch-scoped. Omitted for
   * organization-wide actions.
   */
  branchId?: string;
  /**
   * Organization policy gate. NO organization policies gate authorization in
   * M1, so callers omit it and it defaults to true; wiring
   * ORGANIZATION_CONTRACTS.GetOrganizationPolicy into specific actions is a
   * later decision. Pass an explicit value only when a policy rule exists.
   */
  policyAllows?: boolean;
  /** Correlation id propagated to errors for tracing. */
  correlationId?: string;
}

/**
 * Queries provided by the Identity & Access bounded context.
 */
export interface IdentityContracts {
  /**
   * Evaluate one authorization request against the user's branch-scoped
   * memberships, explicit access list and the given policy gate. Returns the
   * plain decision; use {@link IdentityAuthorization.assertAuthorize} for the
   * throwing form.
   */
  authorize(command: AuthorizeCommand): Promise<AuthorizationDecision>;

  /**
   * Union of permission codes granted to the user across all roles — scoped
   * to one branch when {@link branchId} is supplied, otherwise across every
   * branch of the organization. Throws RESOURCE_NOT_FOUND for unknown users
   * or branches outside the organization.
   */
  getEffectivePermissions(
    userId: string,
    organizationId: string,
    branchId?: string,
  ): Promise<string[]>;
}
