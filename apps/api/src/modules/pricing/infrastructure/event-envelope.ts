import {
  integrationEventEnvelope,
  type IntegrationEventEnvelope,
} from '../../../common/events/integration-envelope';
import type { PricingDomainEvent } from '../domain/events';

/**
 * Creates an architecture-58 integration event envelope for a pricing
 * domain event. Pricing events are always TENANT-scoped.
 *
 * Outbox payloads are integration contracts, not aggregate snapshots.
 * Keep ID-first metadata only; business rules remain in the owning
 * context and are never disclosed to consumers.
 */
export function pricingEventEnvelope(input: {
  event: PricingDomainEvent;
  aggregateId: string;
  aggregateVersion: number;
  correlationId: string;
}): IntegrationEventEnvelope {
  const { type, occurredAt } = input.event;
  const payload = Object.fromEntries(
    Object.entries(input.event).filter(([key]) =>
      [
        'organizationId',
        'priceBookId',
        'priceEntryId',
        'promotionId',
        'couponId',
        'variantId',
        'name',
        'code',
        'isDefault',
        'amount',
        'usedCount',
        'promotionType',
      ].includes(key),
    ),
  );

  return integrationEventEnvelope({
    eventType: `pricing.${type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`,
    eventVersion: 1,
    occurredAt,
    eventScope: 'TENANT',
    organizationId: input.event.organizationId,
    aggregateType: 'Pricing',
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    correlationId: input.correlationId,
    causationId: input.correlationId,
    actor: { id: 'SYSTEM' },
    payload,
  });
}
