import { newId, type DatabaseClient, type PermissionCode } from '@commerce-platform/database';
import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { ORGANIZATION_CONTRACTS, type OrganizationContracts } from '../../organization/contracts';
import { DATABASE } from '../../database/database.tokens';
import { Role } from '../domain/role';
import { User, normalizeEmail } from '../domain/user';
import { RoleRepository } from '../infrastructure/role.repository';
import { UserRepository } from '../infrastructure/user.repository';
import { AuthorizationQueryRepository } from '../infrastructure/authorization.query-repository';

/** Cross-context surface this service consumes from the Organization context. */
type OrganizationContractSurface = Pick<OrganizationContracts, 'getBranch'>;

/**
 * Application service of the Identity & Access context: one method per domain
 * command (docs/architecture/11-identity-access.md), each executed inside a
 * single database transaction that loads the aggregate, applies the command
 * and saves aggregate changes + domain events (transactional outbox).
 *
 * Cross-context references are validated through ORGANIZATION_CONTRACTS
 * (docs/architecture/60-module-contracts.md): branches are confirmed to belong
 * to the caller's organization before any assignment/access write. Roles and
 * users are validated through their own repositories, whose queries are
 * already organization-scoped — a foreign id is indistinguishable from a
 * missing row and fails with RESOURCE_NOT_FOUND. The composite tenant FKs
 * added in this context's schema remain the concurrent-case backstop (Layer 3).
 *
 * Authentication, authorization and entitlement checks are intentionally NOT
 * part of this service yet; they arrive with the HTTP/API layer tasks (the
 * authorization evaluator itself lives in AuthorizationService).
 */
@Injectable()
export class IdentityService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(UserRepository)
    private readonly userRepository: UserRepository,
    @Inject(RoleRepository)
    private readonly roleRepository: RoleRepository,
    // Token-typed on purpose: cross-context access goes through the module
    // contract, never through Organization internals.
    @Inject(ORGANIZATION_CONTRACTS)
    private readonly organizationContracts: OrganizationContractSurface,
  ) {}

  private readonly authorizationQueries = new AuthorizationQueryRepository();

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------

  /**
   * Command: CreateUser. The email is normalized to lowercase and must be
   * globally unique (login identities are global via Supabase Auth);
   * uniqueness races surface as VALIDATION_FAILED through the storage
   * constraint mapping. The owning organization is fixed at creation.
   */
  async createUser(command: {
    organizationId: string;
    email: string;
    name: string;
    /** Optional client-supplied UUIDv7 id; a fresh one is generated otherwise. */
    userId?: string;
    /** Optional Supabase identity to link at creation time. */
    supabaseUserId?: string;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<IdentityUserCommandResult> {
    const userId = command.userId ?? newId();
    const aggregate = User.create({
      id: userId,
      organizationId: command.organizationId,
      email: normalizeEmail(command.email),
      name: command.name,
    });
    if (command.supabaseUserId !== undefined) {
      aggregate.linkIdentity(command.supabaseUserId);
    }

    try {
      const context = this.requireHumanContext(command);
      return await this.persistUser(aggregate, context, 'users.manage');
    } catch (error) {
      throw mapCreateUserError(error);
    }
  }

  /** Command: LinkIdentity — bind the Supabase Auth identity exactly once. */
  async linkIdentity(command: {
    organizationId: string;
    userId: string;
    supabaseUserId: string;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<IdentityUserCommandResult> {
    return this.executeOnUser(
      command.organizationId,
      command.userId,
      (user) => {
        user.linkIdentity(command.supabaseUserId);
      },
      this.requireHumanContext(command),
      'users.manage',
    );
  }

  /** Command: SuspendUser — retains all data; authorization denies the user. */
  async suspendUser(command: {
    organizationId: string;
    userId: string;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<IdentityUserCommandResult> {
    return this.executeOnUser(
      command.organizationId,
      command.userId,
      (user) => {
        user.suspend();
      },
      this.requireHumanContext(command),
      'users.manage',
    );
  }

  /** Command: ReactivateUser (SUSPENDED -> ACTIVE). */
  async reactivateUser(command: {
    organizationId: string;
    userId: string;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<IdentityUserCommandResult> {
    return this.executeOnUser(
      command.organizationId,
      command.userId,
      (user) => {
        user.reactivate();
      },
      this.requireHumanContext(command),
      'users.manage',
    );
  }

  // ---------------------------------------------------------------------------
  // Branch-scoped roles & branch access
  // ---------------------------------------------------------------------------

  /**
   * Command: AssignRole — grant {@link roleId} AT {@link branchId}. Validates
   * role ∈ organization and branch ∈ organization before touching the
   * aggregate. Granting the first role of a branch implicitly grants branch
   * access (documented decision).
   */
  async assignRole(command: {
    organizationId: string;
    userId: string;
    roleId: string;
    branchId: string;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<IdentityUserCommandResult> {
    await this.assertBranchBelongsToOrganization(command.organizationId, command.branchId);

    return this.db.transaction(async (tx) => {
      const context = this.requireHumanContext(command);
      await this.lockOrganizationIdentityAdmin(tx, command.organizationId);
      await this.assertAdmin(tx, command.organizationId, context.actorId, 'role-grants.manage');
      this.rejectSelfMutation(context.actorId, command.userId);
      const user = await this.requireUser(tx, command.organizationId, command.userId);
      await this.requireRole(tx, command.organizationId, command.roleId);

      user.assignRole({ roleId: command.roleId, branchId: command.branchId });

      const eventsPersisted = await this.userRepository.save(tx, user, context);
      return toUserResult(user, eventsPersisted);
    });
  }

  /** Command: RevokeRole. Branch access survives explicit revocation. */
  async revokeRole(command: {
    organizationId: string;
    userId: string;
    roleId: string;
    branchId: string;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<IdentityUserCommandResult> {
    return this.executeOnUser(
      command.organizationId,
      command.userId,
      (user) => {
        user.revokeRole({ roleId: command.roleId, branchId: command.branchId });
      },
      this.requireHumanContext(command),
      'role-grants.manage',
    );
  }

  /**
   * Command: GrantBranchAccess — explicit access WITHOUT any role (e.g.
   * view-only staff).
   */
  async grantBranchAccess(command: {
    organizationId: string;
    userId: string;
    branchId: string;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<IdentityUserCommandResult> {
    await this.assertBranchBelongsToOrganization(command.organizationId, command.branchId);

    return this.executeOnUser(
      command.organizationId,
      command.userId,
      (user) => {
        user.grantBranchAccess(command.branchId);
      },
      this.requireHumanContext(command),
      'branch-access.manage',
      command.branchId,
    );
  }

  /**
   * Command: RevokeBranchAccess — refused by the aggregate while role
   * memberships remain at the branch (revoke those roles first).
   */
  async revokeBranchAccess(command: {
    organizationId: string;
    userId: string;
    branchId: string;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<IdentityUserCommandResult> {
    return this.executeOnUser(
      command.organizationId,
      command.userId,
      (user) => {
        user.revokeBranchAccess(command.branchId);
      },
      this.requireHumanContext(command),
      'branch-access.manage',
      command.branchId,
    );
  }

  // ---------------------------------------------------------------------------
  // Roles
  // ---------------------------------------------------------------------------

  /** Command: CreateRole. New roles start with an empty permission set. */
  async createRole(command: {
    organizationId: string;
    code: string;
    name: string;
    isSystem?: boolean;
    /** Optional client-supplied UUIDv7 id; a fresh one is generated otherwise. */
    roleId?: string;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<IdentityRoleCommandResult> {
    const roleId = command.roleId ?? newId();
    const aggregate = Role.create({
      id: roleId,
      organizationId: command.organizationId,
      code: command.code,
      name: command.name,
      isSystem: command.isSystem,
    });

    try {
      const context = this.requireHumanContext(command);
      return await this.persistRole(aggregate, context, 'roles.manage');
    } catch (error) {
      throw mapCreateRoleError(error);
    }
  }

  /** Command: RenameRole. State-only change (minimal event set). */
  async renameRole(command: {
    organizationId: string;
    roleId: string;
    name: string;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<IdentityRoleCommandResult> {
    return this.executeOnRole(
      command.organizationId,
      command.roleId,
      (role) => {
        role.rename(command.name);
      },
      this.requireHumanContext(command),
      'roles.manage',
    );
  }

  /**
   * Command: SetRolePermissions — REPLACE-set semantics. Every code is
   * validated against the global catalog BEFORE the aggregate mutates, so an
   * unknown code leaves no partial state. System templates stay editable by
   * design ("configurable" cells in the authorization matrix).
   */
  async setRolePermissions(command: {
    organizationId: string;
    roleId: string;
    permissionCodes: readonly PermissionCode[];
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<IdentityRoleCommandResult> {
    return this.db.transaction(async (tx) => {
      const context = this.requireHumanContext(command);
      await this.lockOrganizationIdentityAdmin(tx, command.organizationId);
      await this.assertAdmin(tx, command.organizationId, context.actorId, 'permissions.manage');
      if (
        await this.authorizationQueries.roleIsAssignedToUser(
          tx,
          command.organizationId,
          context.actorId,
          command.roleId,
        )
      )
        this.rejectSelfMutation(context.actorId, context.actorId);
      const role = await this.requireRole(tx, command.organizationId, command.roleId);

      // Validate the FULL target set up front (unknown codes -> VALIDATION_FAILED).
      await this.roleRepository.resolvePermissionCodes(tx, command.permissionCodes);
      role.setPermissions(command.permissionCodes);

      const eventsPersisted = await this.roleRepository.save(tx, role, context);
      return toRoleResult(role, eventsPersisted);
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async executeOnUser(
    organizationId: string,
    userId: string,
    command: (user: User) => void,
    context: MutationContext,
    capability = 'users.manage',
    branchId?: string,
  ): Promise<IdentityUserCommandResult> {
    return this.db.transaction(async (tx) => {
      await this.lockOrganizationIdentityAdmin(tx, organizationId);
      await this.assertAdmin(tx, organizationId, context.actorId, capability, branchId);
      this.rejectSelfMutation(context.actorId, userId);
      const user = await this.requireUser(tx, organizationId, userId);
      command(user);
      const eventsPersisted = await this.userRepository.save(tx, user, context);
      return toUserResult(user, eventsPersisted);
    });
  }

  private async executeOnRole(
    organizationId: string,
    roleId: string,
    command: (role: Role) => void,
    context: MutationContext,
    capability = 'roles.manage',
  ): Promise<IdentityRoleCommandResult> {
    return this.db.transaction(async (tx) => {
      await this.lockOrganizationIdentityAdmin(tx, organizationId);
      await this.assertAdmin(tx, organizationId, context.actorId, capability);
      if (
        await this.authorizationQueries.roleIsAssignedToUser(
          tx,
          organizationId,
          context.actorId,
          roleId,
        )
      )
        this.rejectSelfMutation(context.actorId, context.actorId);
      const role = await this.requireRole(tx, organizationId, roleId);
      command(role);
      const eventsPersisted = await this.roleRepository.save(tx, role, context);
      return toRoleResult(role, eventsPersisted);
    });
  }

  private async persistUser(
    aggregate: User,
    context: MutationContext,
    capability: string,
  ): Promise<IdentityUserCommandResult> {
    return this.db.transaction(async (tx) => {
      await this.lockOrganizationIdentityAdmin(tx, aggregate.organizationId);
      await this.assertAdmin(tx, aggregate.organizationId, context.actorId, capability);
      const eventsPersisted = await this.userRepository.save(tx, aggregate, context);
      return toUserResult(aggregate, eventsPersisted);
    });
  }

  private async persistRole(
    aggregate: Role,
    context: MutationContext,
    capability: string,
  ): Promise<IdentityRoleCommandResult> {
    return this.db.transaction(async (tx) => {
      await this.lockOrganizationIdentityAdmin(tx, aggregate.organizationId);
      await this.assertAdmin(tx, aggregate.organizationId, context.actorId, capability);
      const eventsPersisted = await this.roleRepository.save(tx, aggregate, context);
      return toRoleResult(aggregate, eventsPersisted);
    });
  }

  private async requireUser(
    executor: Parameters<UserRepository['findUser']>[0],
    organizationId: string,
    userId: string,
  ): Promise<User> {
    const user = await this.userRepository.findUser(executor, organizationId, userId);
    if (!user) {
      throw PlatformError.notFound(`User ${userId} was not found.`, {
        details: { userId, organizationId },
      });
    }
    return user;
  }

  private async requireRole(
    executor: Parameters<RoleRepository['findRole']>[0],
    organizationId: string,
    roleId: string,
  ): Promise<Role> {
    const role = await this.roleRepository.findRole(executor, organizationId, roleId);
    if (!role) {
      throw PlatformError.notFound(
        `Role ${roleId} does not belong to organization ${organizationId}.`,
        { details: { roleId, organizationId } },
      );
    }
    return role;
  }

  private async assertBranchBelongsToOrganization(
    organizationId: string,
    branchId: string,
  ): Promise<void> {
    const branch = await this.organizationContracts.getBranch(organizationId, branchId);
    if (!branch) {
      throw PlatformError.notFound(
        `Branch ${branchId} does not belong to organization ${organizationId}.`,
        { details: { branchId, organizationId } },
      );
    }
  }

  /** Normal organization-wide role grants require organization authority. */
  async assignOrganizationRole(command: {
    organizationId: string;
    userId: string;
    roleId: string;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const context = this.requireHumanContext(command);
      await this.lockOrganizationIdentityAdmin(tx, command.organizationId);
      await this.assertAdmin(tx, command.organizationId, context.actorId, 'role-grants.manage');
      this.rejectSelfMutation(context.actorId, command.userId);
      const user = await this.requireUser(tx, command.organizationId, command.userId);
      await this.requireRole(tx, command.organizationId, command.roleId);
      await this.userRepository.assignOrganizationRole(tx, {
        ...command,
        ...context,
        aggregateVersion: user.version,
      });
    });
  }

  async revokeOrganizationRole(command: {
    organizationId: string;
    userId: string;
    roleId: string;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const context = this.requireHumanContext(command);
      await this.lockOrganizationIdentityAdmin(tx, command.organizationId);
      await this.assertAdmin(tx, command.organizationId, context.actorId, 'role-grants.manage');
      this.rejectSelfMutation(context.actorId, command.userId);
      const user = await this.requireUser(tx, command.organizationId, command.userId);
      await this.requireRole(tx, command.organizationId, command.roleId);
      await this.userRepository.revokeOrganizationRole(tx, {
        ...command,
        ...context,
        aggregateVersion: user.version,
      });
    });
  }

  /**
   * Serialize identity-admin authorization and writes for one organization.
   * A hash collision only conservatively serializes two organizations; it
   * cannot weaken authorization. This must be taken before assertAdmin.
   */
  private async lockOrganizationIdentityAdmin(
    executor: Parameters<UserRepository['findUser']>[0],
    organizationId: string,
  ): Promise<void> {
    await executor.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 1))`,
    );
  }

  private requireHumanContext(input: {
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): MutationContext {
    if (!input.actorId || input.actorId === 'SYSTEM') {
      throw PlatformError.permissionDenied(
        'A human actorId is required for identity administration.',
      );
    }
    if (!input.correlationId || !input.causationId) {
      throw PlatformError.validationFailed(
        'correlationId and causationId are required for identity mutations.',
      );
    }
    return {
      actorId: input.actorId,
      correlationId: input.correlationId,
      causationId: input.causationId,
    };
  }

  private async assertAdmin(
    executor: Parameters<UserRepository['findUser']>[0],
    organizationId: string,
    actorId: string | undefined,
    capability: string,
    branchId?: string,
  ): Promise<void> {
    if (!actorId)
      throw PlatformError.permissionDenied('An actorId is required for identity administration.');
    const actor = await this.authorizationQueries.getUser(executor, organizationId, actorId);
    if (!actor)
      throw PlatformError.permissionDenied(
        `Actor ${actorId} is not a member of this organization.`,
      );
    if (actor.status === 'SUSPENDED')
      throw PlatformError.of(ERROR_CODES.ACCOUNT_SUSPENDED, `Actor ${actorId} is suspended.`);
    const orgPermissions = await this.authorizationQueries.getOrganizationPermissions(
      executor,
      organizationId,
      actorId,
    );
    if (orgPermissions.includes(capability)) return;
    if (capability === 'branch-access.manage' && branchId) {
      const [branchPermissions, scope] = await Promise.all([
        this.authorizationQueries.getMembershipPermissions(
          executor,
          organizationId,
          actorId,
          branchId,
        ),
        this.authorizationQueries.getEffectiveBranchScope(executor, organizationId, actorId),
      ]);
      if (
        scope.includes(branchId) &&
        branchPermissions.some((row) => row.permissionCode === capability)
      )
        return;
    }
    throw PlatformError.permissionDenied(`Actor ${actorId} lacks ${capability}.`);
  }

  private rejectSelfMutation(actorId: string | undefined, targetUserId: string): void {
    if (actorId && actorId === targetUserId)
      throw PlatformError.permissionDenied(
        'Actors cannot modify their own identity grants, access, or assigned roles.',
      );
  }
}

interface MutationContext {
  actorId: string;
  correlationId: string;
  causationId: string;
}

// ---------------------------------------------------------------------------
// Results & error mapping
// ---------------------------------------------------------------------------

/** Plain snapshot of a user after a command completed. */
export interface UserSnapshot {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  supabaseUserId: string | null;
  version: number;
}

export interface IdentityUserCommandResult {
  user: UserSnapshot;
  /** Number of domain events appended to the integration outbox. */
  eventsPersisted: number;
}

/** Plain snapshot of a role after a command completed. */
export interface RoleSnapshot {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  isSystem: boolean;
  /** Full granted permission set after the command. */
  permissionCodes: PermissionCode[];
  version: number;
}

export interface IdentityRoleCommandResult {
  role: RoleSnapshot;
  eventsPersisted: number;
}

function toUserResult(user: User, eventsPersisted: number): IdentityUserCommandResult {
  return {
    user: {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      name: user.name,
      status: user.status,
      supabaseUserId: user.supabaseUserId,
      version: user.version,
    },
    eventsPersisted,
  };
}

function toRoleResult(role: Role, eventsPersisted: number): IdentityRoleCommandResult {
  return {
    role: {
      id: role.id,
      organizationId: role.organizationId,
      code: role.code,
      name: role.name,
      isSystem: role.isSystem,
      permissionCodes: [...role.listPermissionCodes()],
      version: role.version,
    },
    eventsPersisted,
  };
}

/**
 * Storage unique violations during CREATE map to VALIDATION_FAILED with the
 * offending field surfaced (email / supabaseUserId); other failures pass
 * through untouched.
 */
function mapCreateUserError(error: unknown): unknown {
  if (
    error instanceof PlatformError &&
    error.code === ERROR_CODES.VALIDATION_FAILED &&
    (error.details?.['field'] === 'email' || error.details?.['field'] === 'supabaseUserId')
  ) {
    return PlatformError.validationFailed(
      error.details['constraint'] === 'users_email_unique'
        ? 'A user with this email already exists.'
        : 'A user with this Supabase identity already exists.',
      { details: error.details, cause: error },
    );
  }
  return error;
}

/** Same contract as {@link mapCreateUserError}, for role business keys. */
function mapCreateRoleError(error: unknown): unknown {
  if (
    error instanceof PlatformError &&
    error.code === ERROR_CODES.VALIDATION_FAILED &&
    error.details?.['field'] === 'code'
  ) {
    return PlatformError.validationFailed(
      'A role with this code already exists in this organization.',
      { details: error.details, cause: error },
    );
  }
  return error;
}
