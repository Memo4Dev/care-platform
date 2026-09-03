import {
  integrationEventEnvelope,
  type IntegrationEventEnvelope,
} from '../../../common/events/integration-envelope';

export type CartEventType =
  | 'cart.cart-created'
  | 'cart.cart-line-added'
  | 'cart.cart-line-updated'
  | 'cart.cart-line-removed';

/** ID-first tenant event envelope for Cart changes. */
export function cartEvent(input: {
  eventType: CartEventType;
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
    aggregateType: 'Cart',
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    correlationId: input.correlationId,
    causationId: input.causationId,
    actor: { id: input.actorId },
    payload: input.payload,
  });
}
