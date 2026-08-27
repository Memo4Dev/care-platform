import {
  integrationEventEnvelope,
  type IntegrationEventEnvelope,
} from '../../../common/events/integration-envelope';

export type CustomerEventType = 'customers.business-customer-created';

export function customerEvent(
  eventType: CustomerEventType,
  organizationId: string,
  aggregateId: string,
  aggregateVersion: number,
  correlationId: string,
  actorId: string,
  payload: Record<string, unknown>,
): IntegrationEventEnvelope {
  return integrationEventEnvelope({
    eventType,
    eventVersion: 1,
    occurredAt: new Date(),
    eventScope: 'TENANT',
    organizationId,
    aggregateType: 'BusinessCustomer',
    aggregateId,
    aggregateVersion,
    correlationId,
    causationId: correlationId,
    actor: { id: actorId },
    payload,
  });
}
