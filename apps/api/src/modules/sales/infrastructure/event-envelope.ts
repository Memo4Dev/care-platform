import {
  integrationEventEnvelope,
  type IntegrationEventEnvelope,
} from '../../../common/events/integration-envelope';

export type SalesEventType = 'sales.sale-created' | 'sales.sale-cancelled' | 'sales.sale-completed';

export function salesEvent(input: {
  eventType: SalesEventType;
  organizationId: string;
  aggregateId: string;
  aggregateVersion: number;
  correlationId: string;
  causationId: string;
  actorId: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}): IntegrationEventEnvelope {
  return integrationEventEnvelope({
    eventType: input.eventType,
    eventVersion: 1,
    occurredAt: input.occurredAt,
    eventScope: 'TENANT',
    organizationId: input.organizationId,
    aggregateType: 'Sale',
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    correlationId: input.correlationId,
    causationId: input.causationId,
    actor: { id: input.actorId },
    payload: input.payload,
  });
}
