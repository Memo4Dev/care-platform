import type { UserStatus } from '../user';

/**
 * Pure authorization evaluator (docs/architecture/72-authorization-matrix.md
 * "Scope Evaluation").
 *
 * The architecture formula is evaluated EXACTLY in this order:
 *
 *   Permission allowed
 *   AND Organization Policy allows action
 *   AND Branch scope includes target Branch
 *   AND Device scope is valid where relevant        <- caller's duty (M8)
 *   AND Resource state allows command               <- caller's duty
 *
 * Two documented refinements, both required to make the formula executable:
 *
 * 1. USER SUSPENSION is checked FIRST. The formula presumes a usable
 *    principal; a suspended user holds no usable rights even though their
 *    data and memberships are retained (docs/architecture/
 *    11-identity-access.md). Denial reason: USER_SUSPENDED.
 *
 * 2. "Permission allowed" is evaluated against the memberships OF THE TARGET
 *    BRANCH when a target branch is supplied — role grants may differ per
 *    branch (docs/architecture/11-identity-access.md). Without a target
 *    branch (organization-wide operation) the union over ALL branches counts.
 *    `branchScope` stays a separate conjunct implementing the explicit access
 *    list, which also covers view-only grants that carry no roles.
 *
 * Device scope (POS devices are M8) and resource-state layers are NOT part of
 * this evaluator: they are the caller's duty per the formula.
 */

/** Why an authorization request was denied. */
export type AuthorizationDenyReason =
  | 'USER_SUSPENDED'
  | 'PERMISSION_UNKNOWN'
  | 'PERMISSION_NOT_HELD'
  | 'ORG_POLICY_DENIED'
  | 'BRANCH_SCOPE_EXCLUDED';

export type AuthorizationDecision =
  | { readonly allowed: true; readonly reason: null }
  | { readonly allowed: false; readonly reason: AuthorizationDenyReason };

export interface AuthorizationMembership {
  /** Branch the membership belongs to. */
  readonly branchId: string;
  /**
   * Union of permission codes across all roles the user holds AT this branch
   * (roleIds already resolved to permissionCodes by the application service).
   */
  readonly permissionCodes: readonly string[];
}

export interface AuthorizationInput {
  /** Capability being requested, e.g. `sales.create`. */
  readonly permissionCode: string;
  readonly user: {
    readonly id: string;
    readonly status: UserStatus;
  };
  /**
   * The user's branch-scoped memberships with resolved permission codes.
   * Empty when the user holds no roles anywhere.
   */
  readonly memberships: readonly AuthorizationMembership[];
  readonly organizationPermissionCodes?: readonly string[];
  /**
   * Effective branch scope: explicit branch_access rows UNION branches where
   * the user holds any role.
   */
  readonly branchScope: readonly string[];
  /** Organization policy gate for this action. No policies gate authz in M1:
   * callers omit it and it defaults to true. */
  readonly policyAllows?: boolean;
  /**
   * Target branch of the action, when the action is branch-scoped. Omitted
   * for organization-wide actions (the branch-scope layer then passes).
   */
  readonly targetBranchId?: string;
  /**
   * The known permission universe (the global catalog codes). When supplied,
   * a code outside it denies with PERMISSION_UNKNOWN instead of the weaker
   * PERMISSION_NOT_HELD.
   */
  readonly knownPermissionCodes?: readonly string[];
}

/**
 * Evaluates one authorization request. Deterministic and side-effect free:
 * the application service composes repository state into the input and maps
 * the returned decision onto platform errors / API responses.
 */
export function evaluateAuthorization(input: AuthorizationInput): AuthorizationDecision {
  // Precondition: usable principal (retained data, denied commands).
  if (input.user.status === 'SUSPENDED') {
    return denied('USER_SUSPENDED');
  }

  // Diagnostic refinement of "Permission allowed": unknown catalog codes are
  // reported distinctly so typos surface as configuration errors.
  if (
    input.knownPermissionCodes !== undefined &&
    !input.knownPermissionCodes.includes(input.permissionCode)
  ) {
    return denied('PERMISSION_UNKNOWN');
  }

  const relevantMemberships =
    input.targetBranchId === undefined
      ? []
      : input.memberships.filter((membership) => membership.branchId === input.targetBranchId);

  const permissionHeld =
    (input.organizationPermissionCodes ?? []).includes(input.permissionCode) ||
    relevantMemberships.some((membership) =>
      membership.permissionCodes.includes(input.permissionCode),
    );
  if (!permissionHeld) {
    return denied('PERMISSION_NOT_HELD');
  }

  if (input.policyAllows === false) {
    return denied('ORG_POLICY_DENIED');
  }

  if (input.targetBranchId !== undefined && !input.branchScope.includes(input.targetBranchId)) {
    return denied('BRANCH_SCOPE_EXCLUDED');
  }

  return { allowed: true, reason: null };
}

function denied(reason: AuthorizationDenyReason): AuthorizationDecision {
  return { allowed: false, reason };
}
