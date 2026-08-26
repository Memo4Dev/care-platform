import {
  integrationEventEnvelope,
  type EventScope,
  type IntegrationEventEnvelope,
} from '../../../common/events/integration-envelope';

export function entitlementEventEnvelope(input: {
  event: Record<string, unknown>;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  eventScope: EventScope;
  actorId: string;
  correlationId: string;
  causationId: string;
}): IntegrationEventEnvelope {
  const { type, occurredAt, ...payload } = input.event;
  return integrationEventEnvelope({
    eventType: `entitlements.${String(type)
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase()}`,
    eventVersion: 1,
    occurredAt: occurredAt instanceof Date ? occurredAt.toISOString() : (occurredAt as string),
    eventScope: input.eventScope,
    organizationId: input.eventScope === 'TENANT' ? (input.event.organizationId as string) : null,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    correlationId: input.correlationId,
    causationId: input.causationId,
    actor: { id: input.actorId },
    payload,
  });
}
