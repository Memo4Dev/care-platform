import {
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { idColumn } from './shared';

/**
 * Integration logical schema: cross-context delivery infrastructure
 * (docs/architecture/30-persistence-overview.md).
 *
 * The outbox is written in the SAME transaction as the aggregate change that
 * produced the events (transactional outbox pattern, rule 12 of
 * docs/architecture/00-overview.md). A relay/worker later publishes rows to
 * their destinations and tracks progress separately; this table is append-only
 * for producers.
 */
export const integrationSchema = pgSchema('integration');

export const integrationOutbox = integrationSchema.table(
  'outbox',
  {
    id: idColumn(),
    /** Bounded-context aggregate family, e.g. `Organization`. */
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    /** Stable event type name, e.g. `OrganizationCreated`. */
    eventType: text('event_type').notNull(),
    /** Full serialized domain event (self-contained payload). */
    payload: jsonb('payload').notNull(),
    correlationId: text('correlation_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set only after the relay has durably handed the EventId to BullMQ. */
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishLeaseId: uuid('publish_lease_id'),
    publishLeaseExpiresAt: timestamp('publish_lease_expires_at', { withTimezone: true }),
    publishAttempts: integer('publish_attempts').notNull().default(0),
    lastPublishError: text('last_publish_error'),
  },
  (table) => [
    index('integration_outbox_occurred_at_idx').on(table.occurredAt),
    index('integration_outbox_relay_claim_idx').on(
      table.publishedAt,
      table.publishLeaseExpiresAt,
      table.occurredAt,
    ),
  ],
);

/** Durable HTTP mutation result used to replay retried Idempotency-Key requests. */
export const idempotencyOutcomes = integrationSchema.table(
  'idempotency_outcomes',
  {
    id: idColumn(),
    scope: text('scope').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status').notNull(),
    responseJson: jsonb('response_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    unique('idempotency_outcomes_scope_key_unique').on(table.scope, table.idempotencyKey),
    index('idempotency_outcomes_created_at_idx').on(table.createdAt),
  ],
);

/**
 * Consumer-side delivery claim. Event identity is consumer-specific: multiple
 * consumers may each handle an event once. A lease prevents a live processor
 * being duplicated while permitting recovery after a worker crash.
 */
export const integrationInbox = integrationSchema.table(
  'inbox',
  {
    eventId: uuid('event_id').notNull(),
    consumer: text('consumer').notNull(),
    status: text('status').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    /** Opaque ownership token prevents an expired claimant from acknowledging a new lease. */
    leaseId: uuid('lease_id'),
  },
  (table) => [
    primaryKey({
      columns: [table.eventId, table.consumer],
      name: 'integration_inbox_event_consumer_pk',
    }),
    index('integration_inbox_consumer_status_idx').on(table.consumer, table.status),
    index('integration_inbox_claim_expiry_idx').on(table.status, table.leaseExpiresAt),
  ],
);
