import { createHash } from 'node:crypto';

import { PlatformError } from '@commerce-platform/contracts';
import { idempotencyOutcomes, newId, type DatabaseClient } from '@commerce-platform/database';
import { and, eq } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';

import { DATABASE } from '../../database/database.tokens';
import type { DbExecutor } from '../infrastructure/db-executor';

/**
 * Runs a Platform Admin HTTP mutation as one local transaction: durable
 * idempotency claim, business aggregate change, transactional outbox, and
 * serialized HTTP result.  It is intentionally an application adapter rather
 * than an HTTP interceptor so no outcome can outlive a rolled-back command.
 */
@Injectable()
export class PlatformAdminMutationAdapter {
  constructor(@Inject(DATABASE) private readonly db: DatabaseClient) {}

  async execute<T>(input: PlatformAdminMutationInput, command: (tx: DbExecutor) => Promise<T>) {
    const requestHash = hash(input.body);
    return this.db.transaction(async (tx) => {
      // PostgreSQL's unique index makes concurrent identical claims wait for
      // the owner transaction, then observe its completed result (or a rollback).
      const claimed = await tx
        .insert(idempotencyOutcomes)
        .values({
          id: newId(),
          scope: input.scope,
          idempotencyKey: input.key,
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
              eq(idempotencyOutcomes.scope, input.scope),
              eq(idempotencyOutcomes.idempotencyKey, input.key),
            ),
          )
          .limit(1);
        if (!previous || previous.requestHash !== requestHash)
          throw PlatformError.idempotencyConflict(
            'Idempotency-Key was already used with a different request.',
          );
        if (previous.status !== 'COMPLETED' || !isOutcome(previous.responseJson))
          throw PlatformError.idempotencyConflict('An idempotent request is still in progress.');
        return previous.responseJson;
      }

      const body: PlatformAdminMutationOutcome<T>['body'] = { data: await command(tx) };
      const outcome: PlatformAdminMutationOutcome<T> = { body };
      await tx
        .update(idempotencyOutcomes)
        .set({ status: 'COMPLETED', responseJson: outcome, completedAt: new Date() })
        .where(
          and(
            eq(idempotencyOutcomes.scope, input.scope),
            eq(idempotencyOutcomes.idempotencyKey, input.key),
          ),
        );
      return outcome;
    });
  }
}

export interface PlatformAdminMutationInput {
  scope: string;
  key: string;
  body: unknown;
}

export interface PlatformAdminMutationOutcome<T> {
  body: { data: T };
}

function hash(value: unknown) {
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

function isOutcome(value: unknown): value is PlatformAdminMutationOutcome<unknown> {
  return !!value && typeof value === 'object' && 'body' in value;
}
