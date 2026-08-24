import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import { PERMISSION_CODES, type DatabaseClient } from '@commerce-platform/database';
import { Inject, Injectable } from '@nestjs/common';

import { ORGANIZATION_CONTRACTS, type OrganizationContracts } from '../../organization/contracts';
import { DATABASE } from '../../database/database.tokens';
import {
  evaluateAuthorization,
  type AuthorizationDecision,
  type AuthorizationMembership,
} from '../domain/authorization/authorize';
import { AuthorizationQueryRepository } from '../infrastructure/authorization.query-repository';
import type { AuthorizeCommand } from '../contracts';

/**
 * Application service behind the Identity module contract's Authorize and
 * GetEffectivePermissions operations (docs/architecture/60-module-contracts.md
 * "Identity & Access").
 *
 * Composes organization-scoped read-model data (user status, branch-scoped
 * memberships resolved to permission codes, explicit access list) into ONE
 * pure {@link evaluateAuthorization} call that implements the scope formula of
 * docs/architecture/72-authorization-matrix.md verbatim:
 *
 *   Permission allowed AND org policy allows AND branch scope includes target.
 *
 * Device scope (POS devices arrive in M8) and resource-state checks are the
 * CALLER'S duty — this service never sees the resource and must not pretend
 * otherwise. No organization policies gate authorization in M1: policyAllows
 * defaults to true; wiring ORGANIZATION_CONTRACTS.GetOrganizationPolicy for
 * specific actions is a later decision.
 */
@Injectable()
export class AuthorizationService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(AuthorizationQueryRepository)
    private readonly queries: Pick<
      AuthorizationQueryRepository,
      'getUser' | 'getMembershipPermissions' | 'getEffectiveBranchScope' | 'getMembershipBranches'
    > &
      Partial<Pick<AuthorizationQueryRepository, 'getOrganizationPermissions'>>,
    // Token-typed on purpose: cross-context access goes through the module
    // contract, never through Organization internals.
    @Inject(ORGANIZATION_CONTRACTS)
    private readonly organizationContracts: Pick<OrganizationContracts, 'getBranch'>,
  ) {}

  /**
   * Evaluate one authorization request. Unknown users (or users of another
   * organization) raise RESOURCE_NOT_FOUND — cross-tenant probes are
   * indistinguishable from misses. Branch ids outside the organization also
   * raise RESOURCE_NOT_FOUND before any permission data is considered.
   */
  async authorize(command: AuthorizeCommand): Promise<AuthorizationDecision> {
    const user = await this.queries.getUser(this.db, command.organizationId, command.userId);
    if (!user) {
      throw PlatformError.notFound(`User ${command.userId} was not found.`, {
        details: { userId: command.userId, organizationId: command.organizationId },
        ...(command.correlationId === undefined ? {} : { correlationId: command.correlationId }),
      });
    }

    if (command.branchId !== undefined) {
      await this.assertBranchBelongsToOrganization(command.organizationId, command.branchId);
    }

    const [membershipRows, organizationPermissions, branchScope] = await Promise.all([
      this.queries.getMembershipPermissions(
        this.db,
        command.organizationId,
        command.userId,
        command.branchId,
      ),
      this.queries.getOrganizationPermissions?.(this.db, command.organizationId, command.userId) ??
        Promise.resolve([]),
      this.queries.getEffectiveBranchScope(this.db, command.organizationId, command.userId),
    ]);

    return evaluateAuthorization({
      permissionCode: command.permissionCode,
      user: { id: user.id, status: user.status },
      memberships: toMemberships(membershipRows),
      organizationPermissionCodes: organizationPermissions,
      branchScope,
      policyAllows: command.policyAllows ?? true,
      targetBranchId: command.branchId,
      knownPermissionCodes: PERMISSION_CODES,
    });
  }

  /**
   * Throwing form of {@link authorize}: maps denial reasons onto the platform
   * error catalog — BRANCH_SCOPE_EXCLUDED becomes BRANCH_ACCESS_DENIED, every
   * other denial becomes PERMISSION_DENIED (M1-004 contract; ACCOUNT_SUSPENDED
   * remains available to the future HTTP layer but is not used here).
   * Returns the decision when allowed so callers can chain.
   */
  async assertAuthorize(command: AuthorizeCommand): Promise<AuthorizationDecision> {
    const decision = await this.authorize(command);
    if (decision.allowed) {
      return decision;
    }

    const details = {
      userId: command.userId,
      organizationId: command.organizationId,
      permissionCode: command.permissionCode,
      reason: decision.reason,
      ...(command.branchId === undefined ? {} : { branchId: command.branchId }),
      ...(command.correlationId === undefined ? {} : { correlationId: command.correlationId }),
    };

    if (decision.reason === 'BRANCH_SCOPE_EXCLUDED') {
      throw PlatformError.branchAccessDenied(
        `User ${command.userId} has no access to branch ${String(command.branchId)}.`,
        { details },
      );
    }

    throw PlatformError.permissionDenied(
      `Permission ${command.permissionCode} denied (reason: ${decision.reason}).`,
      { details },
    );
  }

  /**
   * Union of permission codes granted across the user's roles — scoped to one
   * branch when supplied, otherwise across every branch. Sorted for stable
   * contract output.
   */
  async getEffectivePermissions(
    userId: string,
    organizationId: string,
    branchId?: string,
  ): Promise<string[]> {
    const user = await this.queries.getUser(this.db, organizationId, userId);
    if (!user) {
      throw PlatformError.notFound(`User ${userId} was not found.`, {
        details: { userId, organizationId },
      });
    }
    if (branchId !== undefined) {
      await this.assertBranchBelongsToOrganization(organizationId, branchId);
    }

    if (user.status === 'SUSPENDED') {
      return [];
    }
    const [rows, organizationPermissions] = await Promise.all([
      this.queries.getMembershipPermissions(this.db, organizationId, userId, branchId),
      this.queries.getOrganizationPermissions?.(this.db, organizationId, userId) ??
        Promise.resolve([]),
    ]);

    return [
      ...new Set([...rows.map((row) => row.permissionCode), ...organizationPermissions]),
    ].sort();
  }

  private async assertBranchBelongsToOrganization(
    organizationId: string,
    branchId: string,
  ): Promise<void> {
    const branch = await this.organizationContracts.getBranch(organizationId, branchId);
    if (!branch) {
      throw PlatformError.of(
        ERROR_CODES.RESOURCE_NOT_FOUND,
        `Branch ${branchId} does not belong to organization ${organizationId}.`,
        { details: { branchId, organizationId } },
      );
    }
  }
}

/** Group flat (branch, permission) rows into per-branch memberships. */
function toMemberships(
  rows: Array<{ branchId: string; permissionCode: string }>,
): AuthorizationMembership[] {
  const byBranch = new Map<string, Set<string>>();
  for (const row of rows) {
    let codes = byBranch.get(row.branchId);
    if (!codes) {
      codes = new Set();
      byBranch.set(row.branchId, codes);
    }
    codes.add(row.permissionCode);
  }
  return [...byBranch.entries()].map(([branchId, codes]) => ({
    branchId,
    permissionCodes: [...codes],
  }));
}
