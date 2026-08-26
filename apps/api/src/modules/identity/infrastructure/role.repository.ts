import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import {
  type PermissionCode,
  integrationOutbox,
  newId,
  permissions,
  rolePermissions,
  roles,
} from '@commerce-platform/database';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { Role, type RoleChangeSet } from '../domain/role';
import { IDENTITY_ROLE_AGGREGATE_TYPE } from '../domain/events';
import type { DbExecutor } from './db-executor';
import { mapPersistenceError } from './persistence-error';
import { identityEventEnvelope } from './event-envelope';

/**
 * Repository for the Role aggregate (Layer 2 of
 * docs/architecture/71-multi-tenant-isolation.md).
 *
 * - Every method takes an explicit {@link DbExecutor}; every access is
 *   `organizationId`-scoped.
 * - `save` guards the root row with a version CAS; permission join-table
 *   writes and outbox appends share the same transaction/CAS gate.
 */
export class RoleRepository {
  /**
   * Load one role aggregate with its permission codes. Returns null when the
   * role does not exist in THIS organization (cross-tenant reads are
   * indistinguishable from misses — Layer 2/4 isolation).
   */
  async findRole(
    executor: DbExecutor,
    organizationId: string,
    roleId: string,
  ): Promise<Role | null> {
    const [roleRow] = await executor
      .select()
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.organizationId, organizationId)))
      .limit(1);

    if (!roleRow) {
      return null;
    }

    const permissionRows = await executor
      .select({ code: permissions.code })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, roleId))
      .orderBy(asc(permissions.code));

    return Role.reconstitute({
      id: roleRow.id,
      organizationId: roleRow.organizationId,
      code: roleRow.code,
      name: roleRow.name,
      isSystem: roleRow.isSystem,
      version: roleRow.version,
      permissionCodes: permissionRows.map((row) => row.code) as PermissionCode[],
    });
  }

  /**
   * Find a role by its per-organization business code (e.g. `OWNER`), or
   * null when absent.
   */
  async findByCode(
    executor: DbExecutor,
    organizationId: string,
    code: string,
  ): Promise<Role | null> {
    const [roleRow] = await executor
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.code, code)))
      .limit(1);

    if (!roleRow) {
      return null;
    }
    return this.findRole(executor, organizationId, roleRow.id);
  }

  /** All system templates for one organization, used only by trusted provisioning validation. */
  async listSystemRoles(executor: DbExecutor, organizationId: string): Promise<Role[]> {
    const rows = await executor
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), eq(roles.isSystem, true)));
    return Promise.all(rows.map((row) => this.findRole(executor, organizationId, row.id))).then(
      (resolved) => resolved.filter((role): role is Role => role !== null),
    );
  }

  /**
   * Resolve catalog codes to their ids. Unknown codes raise VALIDATION_FAILED
   * listing every offender (callers validate BEFORE mutating aggregates so a
   * rejected command leaves no partial state).
   */
  async resolvePermissionCodes(
    executor: DbExecutor,
    codes: readonly string[],
  ): Promise<Map<string, string>> {
    if (codes.length === 0) {
      return new Map();
    }

    const rows = await executor
      .select({ id: permissions.id, code: permissions.code })
      .from(permissions)
      .where(inArray(permissions.code, [...codes]));

    const byCode = new Map(rows.map((row) => [row.code, row.id]));
    const unknown = codes.filter((code) => !byCode.has(code));
    if (unknown.length > 0) {
      throw PlatformError.validationFailed(`Unknown permission codes: ${unknown.join(', ')}.`, {
        details: { field: 'permissionCodes', unknownCodes: unknown },
      });
    }
    return byCode;
  }

  /**
   * Persist all pending aggregate changes plus newly collected domain events
   * to the integration outbox — atomically, inside the caller's transaction.
   */
  async save(
    executor: DbExecutor,
    aggregate: Role,
    options: { actorId: string; correlationId: string; causationId: string },
  ): Promise<number> {
    if (!aggregate.hasPendingChanges) {
      return 0;
    }
    const changes = aggregate.collectChanges();

    if (changes.isNew) {
      await this.insertRole(executor, changes);
    } else {
      await this.updateRoleGuarded(executor, changes);
    }

    await this.persistPermissionChanges(executor, changes);

    // Events go out LAST within the transaction.
    const events = aggregate.pullDomainEvents();
    if (events.length > 0) {
      await executor.insert(integrationOutbox).values(
        events.map((event) => ({
          id: newId(),
          aggregateType: IDENTITY_ROLE_AGGREGATE_TYPE,
          aggregateId: changes.roleId,
          eventType: `identity.${event.type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`,
          payload: identityEventEnvelope({
            event,
            aggregateType: IDENTITY_ROLE_AGGREGATE_TYPE,
            aggregateId: changes.roleId,
            aggregateVersion: changes.nextVersion,
            ...options,
          }),
          correlationId: options.correlationId,
          occurredAt: event.occurredAt,
        })),
      );
    }

    aggregate.markPersisted();
    return events.length;
  }

  private async insertRole(executor: DbExecutor, changes: RoleChangeSet): Promise<void> {
    try {
      await executor.insert(roles).values({
        id: changes.roleId,
        organizationId: changes.organizationId,
        code: changes.code,
        name: changes.name,
        isSystem: changes.isSystem,
        version: changes.nextVersion,
      });
    } catch (error) {
      throw mapPersistenceError(error, {
        table: 'identity.roles',
        organizationId: changes.organizationId,
        resourceId: changes.roleId,
      });
    }
  }

  /**
   * Optimistic concurrency gate: exactly one guarded UPDATE for the root row.
   * Zero affected rows means another writer advanced the version first.
   */
  private async updateRoleGuarded(executor: DbExecutor, changes: RoleChangeSet): Promise<void> {
    let updated: Array<{ id: string }>;
    try {
      updated = await executor
        .update(roles)
        .set({
          code: changes.code,
          name: changes.name,
          isSystem: changes.isSystem,
          updatedAt: new Date(),
          version: changes.nextVersion,
        })
        .where(
          and(
            eq(roles.id, changes.roleId),
            eq(roles.organizationId, changes.organizationId),
            eq(roles.version, changes.expectedVersion),
          ),
        )
        .returning({ id: roles.id });
    } catch (error) {
      throw mapPersistenceError(error, {
        table: 'identity.roles',
        organizationId: changes.organizationId,
        resourceId: changes.roleId,
      });
    }

    if (updated.length === 0) {
      throw PlatformError.of(
        ERROR_CODES.RESOURCE_VERSION_CONFLICT,
        `Role ${changes.roleId} was modified concurrently ` +
          `(expected version ${changes.expectedVersion}).`,
        {
          details: {
            roleId: changes.roleId,
            organizationId: changes.organizationId,
            expectedVersion: changes.expectedVersion,
          },
        },
      );
    }
  }

  private async persistPermissionChanges(
    executor: DbExecutor,
    changes: RoleChangeSet,
  ): Promise<void> {
    const touchedCodes = [...changes.newPermissionCodes, ...changes.removedPermissionCodes];
    if (touchedCodes.length === 0) {
      return;
    }

    const idByCode = await this.resolvePermissionIdsForSave(executor, touchedCodes, changes.roleId);

    if (changes.newPermissionCodes.length > 0) {
      try {
        await executor.insert(rolePermissions).values(
          changes.newPermissionCodes.map((code) => ({
            roleId: changes.roleId,
            permissionId: idByCode.get(code)!,
          })),
        );
      } catch (error) {
        throw mapPersistenceError(error, {
          table: 'identity.role_permissions',
          organizationId: changes.organizationId,
          resourceId: changes.roleId,
        });
      }
    }

    if (changes.removedPermissionCodes.length > 0) {
      await executor.delete(rolePermissions).where(
        and(
          eq(rolePermissions.roleId, changes.roleId),
          inArray(
            rolePermissions.permissionId,
            changes.removedPermissionCodes.map((code) => idByCode.get(code)!),
          ),
        ),
      );
    }
  }

  /** Save-time resolution never throws on missing codes that are being REMOVED. */
  private async resolvePermissionIdsForSave(
    executor: DbExecutor,
    codes: readonly string[],
    roleId: string,
  ): Promise<Map<string, string>> {
    const rows = await executor
      .select({ id: permissions.id, code: permissions.code })
      .from(permissions)
      .where(inArray(permissions.code, [...codes]));

    const byCode = new Map(rows.map((row) => [row.code, row.id]));
    const missing = codes.filter((code) => !byCode.has(code));
    if (missing.length > 0) {
      // Can only happen if the catalog lost rows mid-transaction; fail loudly.
      throw PlatformError.validationFailed(
        `Permission catalog is missing codes referenced by role ${roleId}: ${missing.join(', ')}.`,
        { details: { field: 'permissionCodes', unknownCodes: missing } },
      );
    }
    return byCode;
  }
}
