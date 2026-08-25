import { createHash } from 'node:crypto';

import { PlatformError } from '@commerce-platform/contracts';
import { idempotencyOutcomes, newId, type DatabaseClient } from '@commerce-platform/database';
import { and, eq } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';

import { DATABASE } from '../../database/database.tokens';
import type { DbExecutor } from '../infrastructure/db-executor';
import type { OrganizationCommandResult } from './organization.service';
import { OrganizationService } from './organization.service';

/**
 * Local command adapter for tenant HTTP mutations.
 *
 * The idempotency claim, aggregate state, Organization outbox event and the
 * serialized HTTP response intentionally share one PostgreSQL transaction.
 * This is not an interceptor: an interceptor would finish its transaction
 * before the application command and could persist a response for rolled-back
 * business state.
 */
@Injectable()
export class TenantOrganizationMutationAdapter {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(OrganizationService) private readonly organizations: OrganizationService,
  ) {}

  createBranch(
    input: TenantMutationInput<{ code: string; name: string; priority?: number }>,
    beforeCommand?: (tx: DbExecutor) => Promise<void>,
  ) {
    return this.execute(
      input,
      (tx) =>
        this.organizations.createBranchInTransaction(tx, {
          organizationId: input.organizationId,
          code: input.body.code,
          name: input.body.name,
          priority: input.body.priority,
        }),
      beforeCommand,
    );
  }

  createWarehouse(
    input: TenantMutationInput<{ branchId: string; code: string; name: string }>,
    beforeCommand?: (tx: DbExecutor) => Promise<void>,
  ) {
    return this.execute(
      input,
      (tx) =>
        this.organizations.createWarehouseInTransaction(tx, {
          organizationId: input.organizationId,
          branchId: input.body.branchId,
          code: input.body.code,
          name: input.body.name,
        }),
      beforeCommand,
    );
  }

  private async execute<T extends object>(
    input: TenantMutationInput<T>,
    command: (tx: DbExecutor) => Promise<OrganizationCommandResult>,
    beforeCommand?: (tx: DbExecutor) => Promise<void>,
  ): Promise<TenantMutationHttpOutcome> {
    const requestHash = hash(input.body);
    return this.db.transaction(async (tx) => {
      // INSERT ON CONFLICT waits for a concurrent owner to commit or roll back.
      // Thus a racing retry observes either the completed durable response or a
      // cleanly absent claim, never partially committed domain state.
      const claimed = await tx
        .insert(idempotencyOutcomes)
        .values({
          id: newId(),
          scope: input.idempotencyScope,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          status: 'IN_PROGRESS',
        })
        .onConflictDoNothing()
        .returning({ id: idempotencyOutcomes.id });

      if (claimed.length === 0) {
        const [previous] = await tx
          .select({
            requestHash: idempotencyOutcomes.requestHash,
            status: idempotencyOutcomes.status,
            responseJson: idempotencyOutcomes.responseJson,
          })
          .from(idempotencyOutcomes)
          .where(
            and(
              eq(idempotencyOutcomes.scope, input.idempotencyScope),
              eq(idempotencyOutcomes.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (!previous || previous.requestHash !== requestHash) {
          throw PlatformError.idempotencyConflict(
            'Idempotency-Key was already used with a different request.',
          );
        }
        if (previous.status !== 'COMPLETED' || !isOutcome(previous.responseJson)) {
          throw PlatformError.idempotencyConflict('An idempotent request is still in progress.');
        }
        return previous.responseJson;
      }

      // Replay is deliberately resolved before usage/entitlement evaluation.
      // A previously accepted request remains replayable after a plan changes.
      await beforeCommand?.(tx);
      const result = await command(tx);
      const outcome: TenantMutationHttpOutcome = { statusCode: 201, body: { data: result } };
      await tx
        .update(idempotencyOutcomes)
        .set({ status: 'COMPLETED', responseJson: outcome, completedAt: new Date() })
        .where(
          and(
            eq(idempotencyOutcomes.scope, input.idempotencyScope),
            eq(idempotencyOutcomes.idempotencyKey, input.idempotencyKey),
          ),
        );
      return outcome;
    });
  }
}

export interface TenantMutationInput<T extends object> {
  organizationId: string;
  idempotencyScope: string;
  idempotencyKey: string;
  body: T;
}

export interface TenantMutationHttpOutcome {
  statusCode: 201;
  body: { data: OrganizationCommandResult };
}

function hash(value: object): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  return value;
}

function isOutcome(value: unknown): value is TenantMutationHttpOutcome {
  return !!value && typeof value === 'object' && 'body' in value && 'statusCode' in value;
}
