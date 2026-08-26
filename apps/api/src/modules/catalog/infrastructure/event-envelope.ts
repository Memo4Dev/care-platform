import {
  integrationEventEnvelope,
  type IntegrationEventEnvelope,
} from '../../../common/events/integration-envelope';
import type { CatalogDomainEvent } from '../domain/events';

/**
 * Creates architecture-58 integration event envelopes for catalog domain events.
 *
 * Outbox payloads are integration contracts, not aggregate snapshots.
 * Keep ID-first metadata only; display names remain in the owning context
 * and are intentionally never disclosed to consumers.
 */
export function catalogEventEnvelope(input: {
  event: CatalogDomainEvent;
  aggregateId: string;
  aggregateVersion: number;
  correlationId: string;
}): IntegrationEventEnvelope {
  const { type, occurredAt } = input.event;

  const payload = Object.fromEntries(
    Object.entries(input.event).filter(([key]) =>
      [
        'organizationId',
        'productId',
        'variantId',
        'categoryId',
        'unitId',
        'packagingDefinitionId',
        'fromUnitId',
        'toUnitId',
        'barcode',
        'status',
        'name',
        'sku',
        'factor',
      ].includes(key),
    ),
  );

  return integrationEventEnvelope({
    eventType: `catalog.${type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`,
    eventVersion: 1,
    occurredAt,
    eventScope: 'TENANT',
    organizationId: input.event.organizationId,
    aggregateType: 'Catalog',
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    correlationId: input.correlationId,
    causationId: input.correlationId,
    actor: { id: 'SYSTEM' },
    payload,
  });
}
