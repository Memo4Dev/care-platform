import { index, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
  },
  (table) => [index('integration_outbox_occurred_at_idx').on(table.occurredAt)],
);
