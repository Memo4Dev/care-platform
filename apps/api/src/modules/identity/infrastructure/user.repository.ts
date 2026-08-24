import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import {
  branchAccess,
  initialOwnerAssignments,
  integrationOutbox,
  newId,
  userBranchRoles,
  userOrganizationRoles,
  users,
} from '@commerce-platform/database';
import { and, eq } from 'drizzle-orm';

import { User, type UserChangeSet, type UserMembership } from '../domain/user';
import { IDENTITY_USER_AGGREGATE_TYPE } from '../domain/events';
import type { DbExecutor } from './db-executor';
import { mapPersistenceError } from './persistence-error';
import { identityEventEnvelope } from './event-envelope';

/**
 * Repository for the User aggregate (Layer 2 of
 * docs/architecture/71-multi-tenant-isolation.md).
 *
 * - Every method takes an explicit {@link DbExecutor} so the application
 *   service controls the transaction boundary.
 * - Every access is `organizationId`-scoped (Layer 4); memberships and branch
 *   access are only ever loaded/written through the owning aggregate.
 * - `save` performs optimistic concurrency control on the aggregate root row
 *   (`WHERE version = expectedVersion`); a zero-row update raises
 *   RESOURCE_VERSION_CONFLICT. Child writes share the same transaction and
 *   therefore the same CAS gate. Outbox rows go out LAST so readers of the
 *   outbox never observe events for uncommitted state.
 */
export class UserRepository {
  /**
   * Load one user aggregate with its memberships and branch-access rows.
   * Returns null when the user does not exist in THIS organization — a user
   * of another organization is indistinguishable from a nonexistent one.
   */
  async findUser(
    executor: DbExecutor,
    organizationId: string,
    userId: string,
  ): Promise<User | null> {
    const [userRow] = await executor
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.organizationId, organizationId)))
      .limit(1);

    if (!userRow) {
      return null;
    }

    const membershipRows = await executor
      .select({
        branchId: userBranchRoles.branchId,
        roleId: userBranchRoles.roleId,
      })
      .from(userBranchRoles)
      .where(
        and(eq(userBranchRoles.userId, userId), eq(userBranchRoles.organizationId, organizationId)),
      );

    const accessRows = await executor
      .select({ branchId: branchAccess.branchId })
      .from(branchAccess)
      .where(and(eq(branchAccess.userId, userId), eq(branchAccess.organizationId, organizationId)));

    return User.reconstitute({
      id: userRow.id,
      organizationId: userRow.organizationId,
      email: userRow.email,
      name: userRow.name,
      supabaseUserId: userRow.supabaseUserId,
      status: userRow.status,
      version: userRow.version,
      memberships: membershipRows,
      branchAccess: accessRows.map((row) => row.branchId),
    });
  }

  async findUserByEmail(
    executor: DbExecutor,
    organizationId: string,
    email: string,
  ): Promise<User | null> {
    const [row] = await executor
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organizationId, organizationId), eq(users.email, email)))
      .limit(1);
    return row ? this.findUser(executor, organizationId, row.id) : null;
  }

  async findOrganizationRoleHolder(
    executor: DbExecutor,
    input: { organizationId: string; roleId: string },
  ): Promise<string | null> {
    const [row] = await executor
      .select({ userId: userOrganizationRoles.userId })
      .from(userOrganizationRoles)
      .where(
        and(
          eq(userOrganizationRoles.organizationId, input.organizationId),
          eq(userOrganizationRoles.roleId, input.roleId),
        ),
      )
      .limit(1);
    return row?.userId ?? null;
  }

  /**
   * DB-enforced provisioning claim. The organization PK serializes competing
   * initial Owners without restricting later ordinary organization-role grants.
   */
  async claimInitialOwnerAssignment(
    executor: DbExecutor,
    input: { organizationId: string; userId: string; roleId: string },
  ): Promise<{ userId: string; roleId: string; created: boolean }> {
    const inserted = await executor
      .insert(initialOwnerAssignments)
      .values(input)
      .onConflictDoNothing()
      .returning({
        userId: initialOwnerAssignments.userId,
        roleId: initialOwnerAssignments.roleId,
      });
    if (inserted[0]) return { ...inserted[0], created: true };

    const [existing] = await executor
      .select({ userId: initialOwnerAssignments.userId, roleId: initialOwnerAssignments.roleId })
      .from(initialOwnerAssignments)
      .where(eq(initialOwnerAssignments.organizationId, input.organizationId))
      .limit(1);
    if (!existing) {
      throw PlatformError.validationFailed('Initial Owner assignment could not be claimed.');
    }
    return { ...existing, created: false };
  }

  async assignOrganizationRole(
    executor: DbExecutor,
    input: {
      organizationId: string;
      userId: string;
      roleId: string;
      actorId: string;
      correlationId: string;
      causationId: string;
      aggregateVersion: number;
    },
  ): Promise<void> {
    await executor.insert(userOrganizationRoles).values({
      organizationId: input.organizationId,
      userId: input.userId,
      roleId: input.roleId,
    });
    await this.appendOrganizationRoleEvent(executor, input, 'UserOrganizationRoleAssigned');
  }

  async revokeOrganizationRole(
    executor: DbExecutor,
    input: {
      organizationId: string;
      userId: string;
      roleId: string;
      actorId: string;
      correlationId: string;
      causationId: string;
      aggregateVersion: number;
    },
  ): Promise<void> {
    await executor
      .delete(userOrganizationRoles)
      .where(
        and(
          eq(userOrganizationRoles.organizationId, input.organizationId),
          eq(userOrganizationRoles.userId, input.userId),
          eq(userOrganizationRoles.roleId, input.roleId),
        ),
      );
    await this.appendOrganizationRoleEvent(executor, input, 'UserOrganizationRoleRevoked');
  }

  async organizationRoleIsGranted(
    executor: DbExecutor,
    input: { organizationId: string; roleId: string },
  ): Promise<boolean> {
    return (await this.findOrganizationRoleHolder(executor, input)) !== null;
  }

  /**
   * Persist all pending aggregate changes plus newly collected domain events
   * to the integration outbox — atomically, inside the caller's transaction.
   * Returns the number of events written to the outbox; a clean aggregate is
   * skipped entirely (no CAS bump, no outbox noise).
   */
  async save(
    executor: DbExecutor,
    aggregate: User,
    options: { actorId: string; correlationId: string; causationId: string },
  ): Promise<number> {
    if (!aggregate.hasPendingChanges) {
      return 0;
    }
    const changes = aggregate.collectChanges();

    if (changes.isNew) {
      await this.insertUser(executor, changes);
    } else {
      await this.updateUserGuarded(executor, changes);
    }

    await this.persistMembershipChanges(executor, changes);
    await this.persistBranchAccessChanges(executor, changes);

    // Events go out LAST within the transaction.
    const events = aggregate.pullDomainEvents();
    if (events.length > 0) {
      await executor.insert(integrationOutbox).values(
        events.map((event) => ({
          id: newId(),
          aggregateType: IDENTITY_USER_AGGREGATE_TYPE,
          aggregateId: changes.userId,
          eventType: `identity.${event.type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`,
          payload: identityEventEnvelope({
            event,
            aggregateType: IDENTITY_USER_AGGREGATE_TYPE,
            aggregateId: changes.userId,
            aggregateVersion: changes.nextVersion,
            ...options,
          }),
          correlationId: options.correlationId,
          occurredAt: event.occurredAt,
        })),
      );
    }

    // Invariant: markPersisted() only after every write above succeeded.
    aggregate.markPersisted();
    return events.length;
  }

  private async insertUser(executor: DbExecutor, changes: UserChangeSet): Promise<void> {
    try {
      await executor.insert(users).values({
        id: changes.userId,
        organizationId: changes.organizationId,
        supabaseUserId: changes.supabaseUserId,
        email: changes.email,
        name: changes.name,
        status: changes.status,
        version: changes.nextVersion,
      });
    } catch (error) {
      throw mapPersistenceError(error, {
        table: 'identity.users',
        organizationId: changes.organizationId,
        resourceId: changes.userId,
      });
    }
  }

  /**
   * Optimistic concurrency gate: exactly one guarded UPDATE for the root row.
   * Zero affected rows means another writer advanced the version first.
   */
  private async updateUserGuarded(executor: DbExecutor, changes: UserChangeSet): Promise<void> {
    let updated: Array<{ id: string }>;
    try {
      updated = await executor
        .update(users)
        .set({
          email: changes.email,
          name: changes.name,
          supabaseUserId: changes.supabaseUserId,
          status: changes.status,
          updatedAt: new Date(),
          version: changes.nextVersion,
        })
        .where(
          and(
            eq(users.id, changes.userId),
            eq(users.organizationId, changes.organizationId),
            eq(users.version, changes.expectedVersion),
          ),
        )
        .returning({ id: users.id });
    } catch (error) {
      throw mapPersistenceError(error, {
        table: 'identity.users',
        organizationId: changes.organizationId,
        resourceId: changes.userId,
      });
    }

    if (updated.length === 0) {
      throw PlatformError.of(
        ERROR_CODES.RESOURCE_VERSION_CONFLICT,
        `User ${changes.userId} was modified concurrently ` +
          `(expected version ${changes.expectedVersion}).`,
        {
          details: {
            userId: changes.userId,
            organizationId: changes.organizationId,
            expectedVersion: changes.expectedVersion,
          },
        },
      );
    }
  }

  private async persistMembershipChanges(
    executor: DbExecutor,
    changes: UserChangeSet,
  ): Promise<void> {
    if (changes.newMemberships.length > 0) {
      try {
        await executor.insert(userBranchRoles).values(
          changes.newMemberships.map((membership) => ({
            userId: changes.userId,
            organizationId: changes.organizationId,
            branchId: membership.branchId,
            roleId: membership.roleId,
          })),
        );
      } catch (error) {
        // Composite tenant FKs (23503) surface untouched on purpose: they
        // indicate cross-org injection attempts or lost races, never plain
        // validation failures.
        throw mapPersistenceError(error, {
          table: 'identity.user_branch_roles',
          organizationId: changes.organizationId,
          resourceId: changes.userId,
        });
      }
    }

    for (const membership of changes.removedMemberships) {
      await this.deleteMembership(executor, changes.userId, changes.organizationId, membership);
    }
  }

  private async appendOrganizationRoleEvent(
    executor: DbExecutor,
    input: {
      organizationId: string;
      userId: string;
      roleId: string;
      actorId: string;
      correlationId: string;
      causationId: string;
      aggregateVersion: number;
    },
    type: 'UserOrganizationRoleAssigned' | 'UserOrganizationRoleRevoked',
  ): Promise<void> {
    const occurredAt = new Date();
    await executor.insert(integrationOutbox).values({
      id: newId(),
      aggregateType: IDENTITY_USER_AGGREGATE_TYPE,
      aggregateId: input.userId,
      eventType: `identity.${type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`,
      payload: identityEventEnvelope({
        event: {
          type,
          occurredAt,
          organizationId: input.organizationId,
          userId: input.userId,
          roleId: input.roleId,
        },
        aggregateType: IDENTITY_USER_AGGREGATE_TYPE,
        aggregateId: input.userId,
        aggregateVersion: input.aggregateVersion,
        actorId: input.actorId,
        correlationId: input.correlationId,
        causationId: input.causationId,
      }),
      correlationId: input.correlationId,
      occurredAt,
    });
  }

  private async deleteMembership(
    executor: DbExecutor,
    userId: string,
    organizationId: string,
    membership: UserMembership,
  ): Promise<void> {
    await executor
      .delete(userBranchRoles)
      .where(
        and(
          eq(userBranchRoles.userId, userId),
          eq(userBranchRoles.organizationId, organizationId),
          eq(userBranchRoles.branchId, membership.branchId),
          eq(userBranchRoles.roleId, membership.roleId),
        ),
      );
  }

  private async persistBranchAccessChanges(
    executor: DbExecutor,
    changes: UserChangeSet,
  ): Promise<void> {
    if (changes.grantedBranchIds.length > 0) {
      try {
        await executor.insert(branchAccess).values(
          changes.grantedBranchIds.map((branchId) => ({
            userId: changes.userId,
            organizationId: changes.organizationId,
            branchId,
          })),
        );
      } catch (error) {
        throw mapPersistenceError(error, {
          table: 'identity.branch_access',
          organizationId: changes.organizationId,
          resourceId: changes.userId,
        });
      }
    }

    for (const branchId of changes.revokedBranchIds) {
      await executor
        .delete(branchAccess)
        .where(
          and(
            eq(branchAccess.userId, changes.userId),
            eq(branchAccess.organizationId, changes.organizationId),
            eq(branchAccess.branchId, branchId),
          ),
        );
    }
  }
}
