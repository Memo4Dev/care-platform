import {
  integrationEventEnvelope,
  type IntegrationEventEnvelope,
} from '../../../common/events/integration-envelope';

/**
 * Stable purchasing event type names used in the integration outbox.
 *
 * Convention: `purchasing.<entity>-<action>` matching architecture-58.
 */
export type PurchasingEventType =
  | 'purchasing.supplier-created'
  | 'purchasing.supplier-updated'
  | 'purchasing.supplier-deactivated'
  | 'purchasing.purchase-order-created'
  | 'purchasing.purchase-order-submitted'
  | 'purchasing.purchase-order-approved'
  | 'purchasing.purchase-order-rejected'
  | 'purchasing.purchase-order-sent'
  | 'purchasing.purchase-order-cancelled'
  | 'purchasing.goods-receipt-created'
  | 'purchasing.goods-receipt-confirmed'
  | 'purchasing.goods-receipt-cancelled';

/**
 * Creates architecture-58 integration event envelopes for purchasing events.
 *
 * Outbox payloads are integration contracts, not aggregate snapshots.
 * Keep ID-first metadata only; display names remain in the owning context
 * and are intentionally never disclosed to consumers.
 */
export function purchasingEvent(
  eventType: PurchasingEventType,
  organizationId: string,
  aggregateType: string,
  aggregateId: string,
  aggregateVersion: number,
  correlationId: string,
  causationId: string,
  actorId: string,
  payload: Record<string, unknown>,
): IntegrationEventEnvelope {
  return integrationEventEnvelope({
    eventType,
    eventVersion: 1,
    occurredAt: new Date(),
    eventScope: 'TENANT',
    organizationId,
    aggregateType,
    aggregateId,
    aggregateVersion,
    correlationId,
    causationId,
    actor: { id: actorId },
    payload,
  });
}
