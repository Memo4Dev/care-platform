import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import {
  branches,
  integrationOutbox,
  newId,
  organizationPolicies,
  organizations,
  warehouses,
  type PolicyType,
  type PolicyValue,
} from '@commerce-platform/database';
import { and, asc, eq } from 'drizzle-orm';

import { Organization, type OrganizationChangeSet } from '../domain/organization';
import { ORGANIZATION_AGGREGATE_TYPE } from '../domain/events';
import type { DbExecutor } from './db-executor';
import { organizationEventEnvelope } from './event-envelope';

/**
 * Repository for the Organization aggregate (Layer 2 of
 * docs/architecture/71-multi-tenant-isolation.md).
 *
 * - Every method takes an explicit {@link DbExecutor} so the application
 *   service controls the transaction boundary.
 * - Every tenant-owned access is `organizationId`-scoped; child rows are only
 *   ever loaded/written through their owning aggregate.
 * - `save` performs optimistic concurrency control: the aggregate root row is
 *   updated with a `WHERE version = expectedVersion` guard; a zero-row update
 *   raises RESOURCE_VERSION_CONFLICT. Child/policy/outbox writes share the
 *   same transaction and therefore the same CAS gate.
 */
export class OrganizationRepository {
  /**
   * Load one organization aggregate with its branches, warehouses and latest
   * policy state. Returns null when the organization does not exist.
   *
   * Policy history is read in full here; volumes are tiny (policy changes are
   * rare administrative events) and rehydration needs both the per-type latest
   * entries and the org-wide max version. Swap to DISTINCT ON if that ever
   * stops being true.
   */
  async findOrganization(
    executor: DbExecutor,
    organizationId: string,
  ): Promise<Organization | null> {
    const [organizationRow] = await executor
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!organizationRow) {
      return null;
    }

    const branchRows = await executor
      .select()
      .from(branches)
      .where(eq(branches.organizationId, organizationId))
      .orderBy(asc(branches.createdAt));

    const warehouseRows = await executor
      .select()
      .from(warehouses)
      .where(eq(warehouses.organizationId, organizationId))
      .orderBy(asc(warehouses.createdAt));

    const policyRows = await executor
      .select({
        policyType: organizationPolicies.policyType,
        valueJson: organizationPolicies.valueJson,
        version: organizationPolicies.version,
      })
      .from(organizationPolicies)
      .where(eq(organizationPolicies.organizationId, organizationId));

    return Organization.reconstitute({
      id: organizationRow.id,
      name: organizationRow.name,
      status: organizationRow.status,
      version: organizationRow.version,
      branches: branchRows.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        code: row.code,
        name: row.name,
        priority: row.priority,
        isActive: row.isActive,
        version: row.version,
      })),
      warehouses: warehouseRows.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        branchId: row.branchId,
        code: row.code,
        name: row.name,
        isActive: row.isActive,
        version: row.version,
      })),
      policies: policyRows.map((row) => ({
        policyType: row.policyType as PolicyType,
        value: row.valueJson as PolicyValue,
        version: row.version,
      })),
    });
  }

  /**
   * Persist all pending aggregate changes plus newly collected domain events
   * to the integration outbox — atomically, inside the caller's transaction.
   *
   * Returns the number of events written to the outbox. A clean aggregate
   * (no pending changes) is skipped entirely: no CAS bump, no outbox noise.
   */
  async save(
    executor: DbExecutor,
    aggregate: Organization,
    options: { correlationId?: string } = {},
  ): Promise<number> {
    const changes = aggregate.collectChanges();

    if (!aggregate.hasPendingChanges) {
      return 0;
    }

    if (changes.isNew) {
      await this.insertOrganization(executor, changes);
    } else {
      await this.updateOrganizationGuarded(executor, changes);
    }

    await this.persistBranches(executor, changes);
    await this.persistWarehouses(executor, changes);
    await this.persistPolicies(executor, changes);

    // Events go out LAST within the transaction: readers of the outbox must
    // never observe an event for state that is not committed alongside it.
    const events = aggregate.pullDomainEvents();
    if (events.length > 0) {
      await executor.insert(integrationOutbox).values(
        events.map((event) => ({
          id: newId(),
          aggregateType: ORGANIZATION_AGGREGATE_TYPE,
          aggregateId: changes.organizationId,
          eventType: `organization.${event.type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`,
          payload: organizationEventEnvelope({
            event,
            aggregateId: changes.organizationId,
            aggregateVersion: changes.nextVersion,
            correlationId: options.correlationId ?? 'SYSTEM',
          }),
          correlationId: options.correlationId ?? null,
          occurredAt: event.occurredAt,
        })),
      );
    }

    // Invariant: markPersisted() runs only after every write above succeeded.
    // Aggregates are request-scoped and discarded when the transaction fails,
    // so a rolled-back save can never leave a caller holding an aggregate whose
    // in-memory version was advanced past storage — that would silently break
    // the next save's optimistic-concurrency check.
    aggregate.markPersisted();
    return events.length;
  }

  private async insertOrganization(
    executor: DbExecutor,
    changes: OrganizationChangeSet,
  ): Promise<void> {
    try {
      await executor.insert(organizations).values({
        id: changes.organizationId,
        name: changes.name,
        status: changes.status,
        version: changes.nextVersion,
      });
    } catch (error) {
      throw mapPersistenceError(error, {
        action: 'insert',
        table: 'organization.organizations',
        organizationId: changes.organizationId,
      });
    }
  }

  /**
   * Optimistic concurrency gate: exactly one guarded UPDATE for the root row.
   * Zero affected rows means another writer advanced the version first.
   */
  private async updateOrganizationGuarded(
    executor: DbExecutor,
    changes: OrganizationChangeSet,
  ): Promise<void> {
    let updated: Array<{ id: string }>;
    try {
      updated = await executor
        .update(organizations)
        .set({
          name: changes.name,
          status: changes.status,
          updatedAt: new Date(),
          version: changes.nextVersion,
        })
        .where(
          and(
            eq(organizations.id, changes.organizationId),
            eq(organizations.version, changes.expectedVersion),
          ),
        )
        .returning({ id: organizations.id });
    } catch (error) {
      throw mapPersistenceError(error, {
        action: 'update',
        table: 'organization.organizations',
        organizationId: changes.organizationId,
      });
    }

    if (updated.length === 0) {
      throw PlatformError.of(
        ERROR_CODES.RESOURCE_VERSION_CONFLICT,
        `Organization ${changes.organizationId} was modified concurrently ` +
          `(expected version ${changes.expectedVersion}).`,
        {
          details: {
            organizationId: changes.organizationId,
            expectedVersion: changes.expectedVersion,
          },
        },
      );
    }
  }

  private async persistBranches(
    executor: DbExecutor,
    changes: OrganizationChangeSet,
  ): Promise<void> {
    for (const branch of changes.newBranches) {
      try {
        await executor.insert(branches).values({
          id: branch.id,
          organizationId: branch.organizationId,
          code: branch.code,
          name: branch.name,
          priority: branch.priority,
          isActive: branch.isActive,
          version: branch.version,
        });
      } catch (error) {
        throw mapPersistenceError(error, {
          action: 'insert',
          table: 'organization.branches',
          organizationId: branch.organizationId,
          resourceId: branch.id,
        });
      }
    }

    for (const branch of changes.changedBranches) {
      const updated = await executor
        .update(branches)
        .set({
          priority: branch.priority,
          updatedAt: new Date(),
          version: branch.version,
        })
        .where(
          and(
            eq(branches.id, branch.id),
            eq(branches.organizationId, branch.organizationId),
            eq(branches.version, branch.expectedVersion),
          ),
        )
        .returning({ id: branches.id });

      if (updated.length === 0) {
        throw PlatformError.of(
          ERROR_CODES.RESOURCE_VERSION_CONFLICT,
          `Branch ${branch.id} was modified concurrently.`,
          {
            details: {
              branchId: branch.id,
              organizationId: branch.organizationId,
              expectedVersion: branch.expectedVersion,
            },
          },
        );
      }
    }
  }

  private async persistWarehouses(
    executor: DbExecutor,
    changes: OrganizationChangeSet,
  ): Promise<void> {
    for (const warehouse of changes.newWarehouses) {
      try {
        await executor.insert(warehouses).values({
          id: warehouse.id,
          organizationId: warehouse.organizationId,
          branchId: warehouse.branchId,
          code: warehouse.code,
          name: warehouse.name,
          isActive: warehouse.isActive,
          version: warehouse.version,
        });
      } catch (error) {
        throw mapPersistenceError(error, {
          action: 'insert',
          table: 'organization.warehouses',
          organizationId: warehouse.organizationId,
          resourceId: warehouse.id,
        });
      }
    }

    for (const warehouse of changes.changedWarehouses) {
      const updated = await executor
        .update(warehouses)
        .set({
          isActive: warehouse.isActive,
          updatedAt: new Date(),
          version: warehouse.version,
        })
        .where(
          and(
            eq(warehouses.id, warehouse.id),
            eq(warehouses.organizationId, warehouse.organizationId),
            eq(warehouses.version, warehouse.expectedVersion),
          ),
        )
        .returning({ id: warehouses.id });

      if (updated.length === 0) {
        throw PlatformError.of(
          ERROR_CODES.RESOURCE_VERSION_CONFLICT,
          `Warehouse ${warehouse.id} was modified concurrently.`,
          {
            details: {
              warehouseId: warehouse.id,
              organizationId: warehouse.organizationId,
              expectedVersion: warehouse.expectedVersion,
            },
          },
        );
      }
    }
  }

  /** Append-only: policy history rows are INSERT-only by design. */
  private async persistPolicies(
    executor: DbExecutor,
    changes: OrganizationChangeSet,
  ): Promise<void> {
    if (changes.newPolicies.length === 0) {
      return;
    }

    try {
      await executor.insert(organizationPolicies).values(
        changes.newPolicies.map((policy) => ({
          id: newId(),
          organizationId: changes.organizationId,
          policyType: policy.policyType,
          valueJson: policy.value,
          version: policy.version,
        })),
      );
    } catch (error) {
      throw mapPersistenceError(error, {
        action: 'insert',
        table: 'organization.organization_policies',
        organizationId: changes.organizationId,
      });
    }
  }
}

interface PersistenceErrorContext {
  action: 'insert' | 'update';
  table: string;
  organizationId: string;
  resourceId?: string;
}

/**
 * Minimal PG error surface used for mapping (node-postgres errors carry these
 * fields but there is no official typed export worth depending on).
 */
interface PgLikeError {
  code?: unknown;
  constraint?: unknown;
  detail?: unknown;
}

/**
 * Maps storage-level violations onto the platform error catalog:
 *
 * - unique_violation on business keys -> VALIDATION_FAILED (422): well-formed
 *   content violating business rules; the constraint name is preserved in
 *   `details` for support tooling.
 * - everything else is returned untouched: unexpected driver failures must
 *   not be disguised as domain errors.
 *
 * Exported because the root-version CAS gate means repository-driven writes
 * can still surface 23505 from non-aggregate writers (id collisions, manual
 * maintenance inserts); tests pin the mapping contract.
 */
export function mapPersistenceError(error: unknown, context: PersistenceErrorContext): unknown {
  const candidate = error as PgLikeError | null;
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    candidate.code !== '23505' ||
    typeof candidate.constraint !== 'string'
  ) {
    return error;
  }

  const fieldByConstraint: Record<string, string> = {
    branches_org_code_unique: 'code',
    warehouses_org_branch_code_unique: 'code',
    organization_policies_org_version_unique: 'version',
  };

  const field = fieldByConstraint[candidate.constraint] ?? 'constraint';
  return PlatformError.validationFailed(
    `${context.table} constraint ${candidate.constraint} violated during ${context.action}.`,
    {
      details: {
        constraint: candidate.constraint,
        field,
        table: context.table,
        organizationId: context.organizationId,
        ...(context.resourceId === undefined ? {} : { resourceId: context.resourceId }),
      },
      cause: error,
    },
  );
}
