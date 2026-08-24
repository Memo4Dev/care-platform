import {
  branchAccess,
  permissions,
  rolePermissions,
  userBranchRoles,
  userOrganizationRoles,
  users,
} from '@commerce-platform/database';
import { and, eq } from 'drizzle-orm';

import type { DbExecutor } from './db-executor';

/**
 * SELECT-only read model backing the Identity module contract
 * (docs/architecture/60-module-contracts.md "Identity & Access").
 *
 * Deliberately queries projections directly instead of loading aggregates:
 * authorization sits on hot paths (every guarded command) and needs neither
 * aggregate behavior nor CAS state. Every access is organizationId-scoped
 * (Layer 2/4 of docs/architecture/71-multi-tenant-isolation.md).
 */
export class AuthorizationQueryRepository {
  /** The user row of THIS organization, or null (cross-tenant = missing). */
  async getUser(
    executor: DbExecutor,
    organizationId: string,
    userId: string,
  ): Promise<{ id: string; organizationId: string; status: 'ACTIVE' | 'SUSPENDED' } | null> {
    const [row] = await executor
      .select({ id: users.id, organizationId: users.organizationId, status: users.status })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.organizationId, organizationId)))
      .limit(1);

    return row ?? null;
  }

  /**
   * One row per (branch, permission) pair reachable through the user's
   * branch-scoped role grants.
   */
  async getMembershipPermissions(
    executor: DbExecutor,
    organizationId: string,
    userId: string,
    branchId?: string,
  ): Promise<Array<{ branchId: string; permissionCode: string }>> {
    const conditions = [
      eq(userBranchRoles.userId, userId),
      eq(userBranchRoles.organizationId, organizationId),
    ];
    if (branchId !== undefined) {
      conditions.push(eq(userBranchRoles.branchId, branchId));
    }

    return (
      executor
        // A user can hold several roles at one branch; DISTINCT keeps each
        // (branch, permission) pair once for clean union semantics downstream.
        .selectDistinct({
          branchId: userBranchRoles.branchId,
          permissionCode: permissions.code,
        })
        .from(userBranchRoles)
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, userBranchRoles.roleId))
        .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(and(...conditions))
    );
  }

  /** Permissions carried by organization-scoped role grants only. */
  async getOrganizationPermissions(
    executor: DbExecutor,
    organizationId: string,
    userId: string,
  ): Promise<string[]> {
    const rows = await executor
      .selectDistinct({ permissionCode: permissions.code })
      .from(userOrganizationRoles)
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userOrganizationRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(
        and(
          eq(userOrganizationRoles.userId, userId),
          eq(userOrganizationRoles.organizationId, organizationId),
        ),
      );
    return rows.map((row) => row.permissionCode);
  }

  async roleIsAssignedToUser(
    executor: DbExecutor,
    organizationId: string,
    userId: string,
    roleId: string,
  ): Promise<boolean> {
    const [orgGrant, branchGrant] = await Promise.all([
      executor
        .select({ roleId: userOrganizationRoles.roleId })
        .from(userOrganizationRoles)
        .where(
          and(
            eq(userOrganizationRoles.userId, userId),
            eq(userOrganizationRoles.roleId, roleId),
            eq(userOrganizationRoles.organizationId, organizationId),
          ),
        )
        .limit(1),
      executor
        .select({ roleId: userBranchRoles.roleId })
        .from(userBranchRoles)
        .where(
          and(
            eq(userBranchRoles.userId, userId),
            eq(userBranchRoles.roleId, roleId),
            eq(userBranchRoles.organizationId, organizationId),
          ),
        )
        .limit(1),
    ]);
    return orgGrant.length > 0 || branchGrant.length > 0;
  }

  /**
   * Branches where the user holds at least one role — half of the effective
   * scope formula (see {@link getEffectiveBranchScope}).
   */
  async getMembershipBranches(
    executor: DbExecutor,
    organizationId: string,
    userId: string,
  ): Promise<string[]> {
    const rows = await executor
      .selectDistinct({ branchId: userBranchRoles.branchId })
      .from(userBranchRoles)
      .where(
        and(eq(userBranchRoles.userId, userId), eq(userBranchRoles.organizationId, organizationId)),
      );
    return rows.map((row) => row.branchId);
  }

  /**
   * Effective branch scope per M1-004 decision: explicit `branch_access`
   * rows UNION branches reached through role grants. Role-derived access is
   * mirrored into branch_access by the User aggregate, so in practice this is
   * just branch_access; computing the union keeps the evaluator correct even
   * if a legacy/manual writer ever skips that mirroring.
   */
  async getEffectiveBranchScope(
    executor: DbExecutor,
    organizationId: string,
    userId: string,
  ): Promise<string[]> {
    const [accessRows, membershipBranches] = await Promise.all([
      executor
        .select({ branchId: branchAccess.branchId })
        .from(branchAccess)
        .where(
          and(eq(branchAccess.userId, userId), eq(branchAccess.organizationId, organizationId)),
        ),
      this.getMembershipBranches(executor, organizationId, userId),
    ]);

    return [...new Set([...accessRows.map((row) => row.branchId), ...membershipBranches])];
  }
}
