import { newId } from '@commerce-platform/database';

export const SYSTEM_ACTOR_ID = 'SYSTEM' as const;

export function identityEventEnvelope(input: {
  event: object;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  actorId: string;
  correlationId: string;
  causationId: string;
}): Record<string, unknown> {
  const event = input.event as Record<string, unknown>;
  // Events are ID-first integration contracts (ADR-0002): profile and role
  // labels are intentionally never copied into the outbox payload.
  const payload = Object.fromEntries(
    Object.entries(event).filter(([key]) =>
      ['organizationId', 'userId', 'roleId', 'branchId', 'permissionCodes'].includes(key),
    ),
  );
  const { type, occurredAt } = event;
  return {
    eventId: newId(),
    eventType: `identity.${String(type)
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase()}`,
    eventVersion: 1,
    occurredAt: occurredAt instanceof Date ? occurredAt.toISOString() : occurredAt,
    organizationId: event.organizationId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    correlationId: input.correlationId,
    causationId: input.causationId,
    actor: { id: input.actorId },
    payload,
  };
}
