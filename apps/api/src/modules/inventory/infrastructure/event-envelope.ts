import {
  integrationEventEnvelope,
  type IntegrationEventEnvelope,
} from '../../../common/events/integration-envelope';

/**
 * Stable inventory event type names used in the integration outbox.
 *
 * Convention: `inventory.<entity>-<action>` matching architecture-58.
 */
export type InventoryEventType =
  | 'inventory.stock-position-created'
  | 'inventory.stock-received'
  | 'inventory.stock-consumed'
  | 'inventory.stock-reserved'
  | 'inventory.reservation-released'
  | 'inventory.reservation-expired'
  | 'inventory.reservation-consumed'
  | 'inventory.allocation-created'
  | 'inventory.allocation-released'
  | 'inventory.allocation-expired'
  | 'inventory.allocation-consumed'
  | 'inventory.transfer-created'
  | 'inventory.transfer-dispatched'
  | 'inventory.transfer-received'
  | 'inventory.transfer-cancelled'
  | 'inventory.adjustment-applied';

/**
 * Creates architecture-58 integration event envelopes for inventory events.
 *
 * Outbox payloads are integration contracts, not aggregate snapshots.
 * Keep ID-first metadata only; display names remain in the owning context
 * and are intentionally never disclosed to consumers.
 */
export function inventoryEvent(
  eventType: InventoryEventType,
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
