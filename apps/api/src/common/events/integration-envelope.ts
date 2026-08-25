import { PlatformError } from '@commerce-platform/contracts';
import { newId } from '@commerce-platform/database';

export type EventScope = 'TENANT' | 'GLOBAL';

export interface IntegrationEventEnvelope {
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  eventScope: EventScope;
  organizationId: string | null;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  correlationId: string;
  causationId: string;
  actor: { id: string };
  payload: Record<string, unknown>;
}

/** Validates the architecture-58 scope invariant at producer and consumer boundaries. */
export function assertIntegrationEventEnvelope(
  value: unknown,
): asserts value is IntegrationEventEnvelope {
  const event = value as Partial<IntegrationEventEnvelope> | null;
  if (
    !event ||
    typeof event !== 'object' ||
    (event.eventScope !== 'TENANT' && event.eventScope !== 'GLOBAL')
  ) {
    throw PlatformError.validationFailed('Integration event must declare eventScope.', {
      details: { field: 'eventScope' },
    });
  }
  if (
    event.eventScope === 'TENANT' &&
    (!event.organizationId || typeof event.organizationId !== 'string')
  ) {
    throw PlatformError.validationFailed('TENANT event requires organizationId.', {
      details: { field: 'organizationId' },
    });
  }
  if (event.eventScope === 'GLOBAL' && event.organizationId !== null) {
    throw PlatformError.validationFailed('GLOBAL event requires organizationId to be null.', {
      details: { field: 'organizationId' },
    });
  }
}

export function integrationEventEnvelope(
  input: Omit<IntegrationEventEnvelope, 'eventId' | 'occurredAt'> & { occurredAt: Date | string },
): IntegrationEventEnvelope {
  const envelope: IntegrationEventEnvelope = {
    ...input,
    eventId: newId(),
    occurredAt:
      input.occurredAt instanceof Date ? input.occurredAt.toISOString() : input.occurredAt,
  };
  assertIntegrationEventEnvelope(envelope);
  return envelope;
}
