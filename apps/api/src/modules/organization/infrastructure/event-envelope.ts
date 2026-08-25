import {
  integrationEventEnvelope,
  type IntegrationEventEnvelope,
} from '../../../common/events/integration-envelope';
import type { OrganizationDomainEvent } from '../domain/events';

export function organizationEventEnvelope(input: {
  event: OrganizationDomainEvent;
  aggregateId: string;
  aggregateVersion: number;
  correlationId: string;
}): IntegrationEventEnvelope {
  const { type, occurredAt } = input.event;
  // Outbox payloads are integration contracts, not aggregate snapshots.
  // Keep ID-first metadata only; display names and policy values remain in the
  // owning context and are intentionally never disclosed to consumers.
  const payload = Object.fromEntries(
    Object.entries(input.event).filter(([key]) =>
      [
        'organizationId',
        'branchId',
        'warehouseId',
        'code',
        'status',
        'priority',
        'policyType',
        'policyVersion',
      ].includes(key),
    ),
  );
  return integrationEventEnvelope({
    eventType: `organization.${type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`,
    eventVersion: 1,
    occurredAt,
    eventScope: 'TENANT',
    organizationId: input.event.organizationId,
    aggregateType: 'Organization',
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    correlationId: input.correlationId,
    causationId: input.correlationId,
    actor: { id: 'SYSTEM' },
    payload,
  });
}
