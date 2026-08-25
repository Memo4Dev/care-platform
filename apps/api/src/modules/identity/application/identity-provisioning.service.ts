import { newId, type DatabaseClient } from '@commerce-platform/database';
import { PlatformError } from '@commerce-platform/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.tokens';
import { Role } from '../domain/role';
import { User, normalizeEmail } from '../domain/user';
import { RoleRepository } from '../infrastructure/role.repository';
import { UserRepository } from '../infrastructure/user.repository';
import type { IdentityProvisioningContracts } from '../provisioning.contracts';
import { DEFAULT_ROLE_TEMPLATES } from './identity-defaults';
import type { IdentityUserCommandResult, UserSnapshot } from './identity.service';

/**
 * Trusted Identity boundary for Tenant Provisioning only. SYSTEM is internal;
 * the module exports this behavior only through IDENTITY_PROVISIONING.
 */
@Injectable()
export class IdentityProvisioningService implements IdentityProvisioningContracts {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(UserRepository) private readonly users: UserRepository,
    @Inject(RoleRepository) private readonly roles: RoleRepository,
  ) {}

  /** Atomically establish the one initial Owner for an organization. */
  async provisionInitialOwner(command: {
    organizationId: string;
    email: string;
    name: string;
    userId?: string;
    supabaseUserId?: string;
    correlationId: string;
    causationId: string;
  }): Promise<IdentityUserCommandResult> {
    const context = provisioningContext(command);
    return this.db.transaction(async (tx) => {
      // This is the same organization identity-admin lock used by ordinary
      // role/permission/grant mutations. The durable PK claim below remains
      // the authority for initial-Owner uniqueness.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${command.organizationId}, 1))`,
      );
      const { user, eventsPersisted } = await this.resolveInitialUser(tx, command, context);
      await this.ensureDefaultRoleTemplates(tx, command.organizationId, context);
      const ownerRole = await this.roles.findByCode(tx, command.organizationId, 'OWNER');
      if (!ownerRole || !ownerRole.isSystem) {
        throw PlatformError.validationFailed('The seeded Owner template is required.');
      }

      const claim = await this.users.claimInitialOwnerAssignment(tx, {
        organizationId: command.organizationId,
        userId: user.id,
        roleId: ownerRole.id,
      });
      if (claim.userId !== user.id || claim.roleId !== ownerRole.id) {
        throw PlatformError.validationFailed('A different initial Owner is already established.');
      }
      // A durable claim, not mutable later role grants, defines bootstrap retry
      // idempotency. Do not recreate a grant that was later revoked.
      if (claim.created) {
        await this.users.assignOrganizationRole(tx, {
          organizationId: command.organizationId,
          userId: user.id,
          roleId: ownerRole.id,
          ...context,
          aggregateVersion: user.version,
        });
      }

      return { user: userSnapshot(user), eventsPersisted };
    });
  }

  /**
   * The default branch is created after the initial Owner. Grant its explicit
   * branch scope through the provisioning-only contract so a completed tenant
   * can satisfy the M1 owner-login readiness flow without exposing SYSTEM
   * identity administration to another context.
   */
  async grantInitialOwnerBranchAccess(input: {
    organizationId: string;
    userId: string;
    branchId: string;
    correlationId: string;
    causationId: string;
  }): Promise<void> {
    const context = provisioningContext(input);
    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.organizationId}, 1))`,
      );
      const assignment = await this.users.findInitialOwnerAssignment(tx, input.organizationId);
      if (assignment?.userId !== input.userId)
        throw PlatformError.permissionDenied(
          'Only the durable initial Owner may receive bootstrap access.',
        );
      const user = await this.users.findUser(tx, input.organizationId, input.userId);
      if (!user) throw PlatformError.validationFailed('Initial Owner was not found.');
      if (user.hasBranchAccess(input.branchId)) return;
      user.grantBranchAccess(input.branchId);
      await this.users.save(tx, user, context);
    });
  }

  private async resolveInitialUser(
    tx: Parameters<UserRepository['findUser']>[0],
    command: {
      organizationId: string;
      email: string;
      name: string;
      userId?: string;
      supabaseUserId?: string;
    },
    context: ProvisioningContext,
  ): Promise<{ user: User; eventsPersisted: number }> {
    const email = normalizeEmail(command.email);
    const existing = await this.users.findUserByEmail(tx, command.organizationId, email);
    if (existing) {
      if (
        existing.name !== command.name ||
        existing.supabaseUserId !== (command.supabaseUserId ?? null) ||
        (command.userId !== undefined && existing.id !== command.userId)
      ) {
        throw PlatformError.validationFailed(
          'Initial Owner identity does not match the existing user.',
        );
      }
      return { user: existing, eventsPersisted: 0 };
    }

    const user = User.create({
      id: command.userId ?? newId(),
      organizationId: command.organizationId,
      email,
      name: command.name,
    });
    if (command.supabaseUserId !== undefined) user.linkIdentity(command.supabaseUserId);
    return { user, eventsPersisted: await this.users.save(tx, user, context) };
  }

  private async ensureDefaultRoleTemplates(
    tx: Parameters<RoleRepository['listSystemRoles']>[0],
    organizationId: string,
    context: ProvisioningContext,
  ): Promise<void> {
    const existing = await this.roles.listSystemRoles(tx, organizationId);
    if (existing.length === 0) {
      for (const template of DEFAULT_ROLE_TEMPLATES) {
        const role = Role.create({
          id: newId(),
          organizationId,
          code: template.code,
          name: template.name,
          isSystem: true,
        });
        await this.roles.save(tx, role, context);
        await this.roles.resolvePermissionCodes(tx, template.permissionCodes);
        role.setPermissions(template.permissionCodes);
        await this.roles.save(tx, role, context);
      }
    }
    await this.assertExactTemplateSet(tx, organizationId);
  }

  private async assertExactTemplateSet(
    tx: Parameters<RoleRepository['listSystemRoles']>[0],
    organizationId: string,
  ): Promise<void> {
    const systemRoles = await this.roles.listSystemRoles(tx, organizationId);
    if (systemRoles.length !== DEFAULT_ROLE_TEMPLATES.length) {
      throw PlatformError.validationFailed(
        'The complete default role template set must exist first.',
      );
    }
    for (const template of DEFAULT_ROLE_TEMPLATES) {
      const role = systemRoles.find((candidate) => candidate.code === template.code);
      if (
        !role ||
        role.name !== template.name ||
        !sameSet(role.listPermissionCodes(), template.permissionCodes)
      ) {
        throw PlatformError.validationFailed(
          'The complete default role template set must exist first.',
        );
      }
    }
  }
}

interface ProvisioningContext {
  actorId: 'SYSTEM';
  correlationId: string;
  causationId: string;
}

function provisioningContext(input: {
  correlationId: string;
  causationId: string;
}): ProvisioningContext {
  if (!input.correlationId || !input.causationId) {
    throw PlatformError.validationFailed(
      'correlationId and causationId are required for identity provisioning.',
    );
  }
  return { actorId: 'SYSTEM', correlationId: input.correlationId, causationId: input.causationId };
}

function sameSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value) => expected.includes(value));
}

function userSnapshot(user: User): UserSnapshot {
  return {
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    name: user.name,
    status: user.status,
    supabaseUserId: user.supabaseUserId,
    version: user.version,
  };
}
