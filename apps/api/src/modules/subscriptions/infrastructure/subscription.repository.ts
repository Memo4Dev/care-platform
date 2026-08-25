import { and, asc, eq, inArray } from 'drizzle-orm';
import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import {
  integrationOutbox,
  newId,
  subscriptionPeriods,
  subscriptions,
} from '@commerce-platform/database';
import { integrationEventEnvelope } from '../../../common/events/integration-envelope';
import { Subscription } from '../domain/subscription';
import { SUBSCRIPTION_AGGREGATE_TYPE } from '../domain/events';
import type { DbExecutor } from '../../entitlements/infrastructure/db-executor';

export interface AuditContext {
  actorId: string;
  correlationId: string;
  causationId: string;
}
export class SubscriptionRepository {
  async find(executor: DbExecutor, organizationId: string, subscriptionId: string) {
    const [row] = await executor
      .select()
      .from(subscriptions)
      .where(
        and(eq(subscriptions.id, subscriptionId), eq(subscriptions.organizationId, organizationId)),
      )
      .limit(1);
    if (!row) return null;
    const periods = await executor
      .select()
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.subscriptionId, subscriptionId))
      .orderBy(asc(subscriptionPeriods.effectiveAt));
    return Subscription.reconstitute({
      ...row,
      periods: periods.map((p) => ({
        ...p,
        amount: p.amount,
        currency: p.currency,
        billingReference: p.billingReference,
      })),
    });
  }
  async findBusinessAccess(executor: DbExecutor, organizationId: string, now = new Date()) {
    const [row] = await executor
      .select({
        organizationId: subscriptions.organizationId,
        planId: subscriptions.planId,
        status: subscriptions.status,
        trialEndsAt: subscriptions.trialEndsAt,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.organizationId, organizationId),
          inArray(subscriptions.status, ['TRIAL', 'ACTIVE']),
        ),
      )
      .limit(1);
    if (!row) return null;
    if (row.status === 'TRIAL' && (!row.trialEndsAt || row.trialEndsAt.getTime() <= now.getTime()))
      return null;
    if (row.status === 'ACTIVE' && row.currentPeriodEnd.getTime() <= now.getTime()) return null;
    return { ...row, status: row.status as 'TRIAL' | 'ACTIVE' };
  }
  async save(executor: DbExecutor, subscription: Subscription, audit: AuditContext) {
    if (!subscription.hasPendingChanges) return 0;
    const c = subscription.collectChanges();
    if (c.isNew)
      await executor.insert(subscriptions).values({
        id: c.subscriptionId,
        organizationId: c.organizationId,
        planId: c.planId,
        status: c.status,
        billingCycle: c.billingCycle,
        startedAt: c.startedAt,
        currentPeriodStart: c.currentPeriodStart,
        currentPeriodEnd: c.currentPeriodEnd,
        trialEndsAt: c.trialEndsAt,
        cancelAtPeriodEnd: c.cancelAtPeriodEnd,
        billingProvider: c.billingProvider,
        billingProviderReference: c.billingProviderReference,
        version: c.nextVersion,
      });
    else {
      const updated = await executor
        .update(subscriptions)
        .set({
          planId: c.planId,
          status: c.status,
          currentPeriodStart: c.currentPeriodStart,
          currentPeriodEnd: c.currentPeriodEnd,
          trialEndsAt: c.trialEndsAt,
          cancelAtPeriodEnd: c.cancelAtPeriodEnd,
          billingProvider: c.billingProvider,
          billingProviderReference: c.billingProviderReference,
          version: c.nextVersion,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(subscriptions.id, c.subscriptionId),
            eq(subscriptions.organizationId, c.organizationId),
            eq(subscriptions.version, c.expectedVersion),
          ),
        )
        .returning({ id: subscriptions.id });
      if (!updated.length)
        throw PlatformError.of(
          ERROR_CODES.RESOURCE_VERSION_CONFLICT,
          `Subscription ${c.subscriptionId} was modified concurrently.`,
          { details: { subscriptionId: c.subscriptionId, expectedVersion: c.expectedVersion } },
        );
    }
    if (c.newPeriods.length)
      await executor
        .insert(subscriptionPeriods)
        .values(c.newPeriods.map((p) => ({ ...p, subscriptionId: c.subscriptionId })));
    const events = subscription.pullDomainEvents();
    if (events.length)
      await executor.insert(integrationOutbox).values(
        events.map((event) => ({
          id: newId(),
          aggregateType: SUBSCRIPTION_AGGREGATE_TYPE,
          aggregateId: c.subscriptionId,
          eventType: `subscription.${event.type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`,
          payload: integrationEventEnvelope({
            eventType: `subscription.${event.type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`,
            eventVersion: 1,
            occurredAt: event.occurredAt,
            eventScope: 'TENANT',
            organizationId: event.organizationId,
            aggregateType: SUBSCRIPTION_AGGREGATE_TYPE,
            aggregateId: c.subscriptionId,
            aggregateVersion: c.nextVersion,
            correlationId: audit.correlationId,
            causationId: audit.causationId,
            actor: { id: audit.actorId },
            payload: {
              subscriptionId: event.subscriptionId,
              organizationId: event.organizationId,
              planId: event.planId,
              status: event.status,
              billingCycle: event.billingCycle,
              ...(event.effectiveAt ? { effectiveAt: event.effectiveAt.toISOString() } : {}),
            },
          }),
          correlationId: audit.correlationId,
          occurredAt: event.occurredAt,
        })),
      );
    subscription.markPersisted();
    return events.length;
  }
}
