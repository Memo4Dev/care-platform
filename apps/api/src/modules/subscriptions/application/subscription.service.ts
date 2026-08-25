import { Inject, Injectable } from '@nestjs/common';
import { newId, type BillingCycle } from '@commerce-platform/database';
import { PlatformError } from '@commerce-platform/contracts';
import { DATABASE } from '../../database/database.tokens';
import type { DatabaseClient } from '@commerce-platform/database';
import { Subscription } from '../domain/subscription';
import {
  SubscriptionRepository,
  type AuditContext,
} from '../infrastructure/subscription.repository';

@Injectable()
export class SubscriptionService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly repository: SubscriptionRepository,
  ) {}
  async startTrial(
    c: {
      subscriptionId?: string;
      organizationId: string;
      planId: string;
      billingCycle: BillingCycle;
      startedAt: Date;
      trialEndsAt: Date;
      periodEnd: Date;
    } & AuditContext,
  ) {
    const s = Subscription.startTrial({ ...c, id: c.subscriptionId ?? newId(), periodId: newId() });
    return this.db.transaction(async (tx) => ({
      subscription: snapshot(s),
      eventsPersisted: await this.repository.save(tx, s, c),
    }));
  }
  async activate(
    c: {
      organizationId: string;
      subscriptionId: string;
      provider?: string | null;
      reference?: string | null;
    } & AuditContext,
  ) {
    return this.execute(c, (s) => s.activate({ provider: c.provider, reference: c.reference }));
  }
  async changePlan(
    c: {
      organizationId: string;
      subscriptionId: string;
      planId: string;
      effectiveAt: Date;
    } & AuditContext,
  ) {
    return this.execute(c, (s) =>
      s.changePlan({ planId: c.planId, effectiveAt: c.effectiveAt, periodId: newId() }),
    );
  }
  async scheduleCancellation(c: { organizationId: string; subscriptionId: string } & AuditContext) {
    return this.execute(c, (s) => s.scheduleCancellation());
  }
  async cancel(c: { organizationId: string; subscriptionId: string } & AuditContext) {
    return this.execute(c, (s) => s.cancel());
  }
  async renew(
    c: {
      organizationId: string;
      subscriptionId: string;
      periodStart: Date;
      periodEnd: Date;
      billingReference?: string | null;
    } & AuditContext,
  ) {
    return this.execute(c, (s) => s.renew({ ...c, periodId: newId() }));
  }
  async markPastDue(c: { organizationId: string; subscriptionId: string } & AuditContext) {
    return this.execute(c, (s) => s.markPastDue());
  }
  async suspend(c: { organizationId: string; subscriptionId: string } & AuditContext) {
    return this.execute(c, (s) => s.suspend());
  }
  async reactivate(c: { organizationId: string; subscriptionId: string } & AuditContext) {
    return this.execute(c, (s) => s.reactivate());
  }
  async extendTrial(
    c: { organizationId: string; subscriptionId: string; trialEndsAt: Date } & AuditContext,
  ) {
    return this.execute(c, (s) => s.extendTrial({ trialEndsAt: c.trialEndsAt, periodId: newId() }));
  }
  private async execute(
    c: { organizationId: string; subscriptionId: string } & AuditContext,
    action: (s: Subscription) => void,
  ) {
    return this.db.transaction(async (tx) => {
      const s = await this.repository.find(tx, c.organizationId, c.subscriptionId);
      if (!s) throw PlatformError.notFound(`Subscription ${c.subscriptionId} was not found.`);
      action(s);
      const result = {
        subscription: snapshot(s),
        eventsPersisted: await this.repository.save(tx, s, c),
      };
      return result;
    });
  }
}
function snapshot(s: Subscription) {
  return {
    id: s.id,
    organizationId: s.organizationId,
    planId: s.planId,
    status: s.status,
    billingCycle: s.billingCycle,
    version: s.version,
  };
}
