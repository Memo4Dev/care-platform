import { Inject, Injectable } from '@nestjs/common';
import type { DatabaseClient } from '@commerce-platform/database';
import { sql } from 'drizzle-orm';

import { eventDeliveryMetrics } from '../../common/events/event-delivery.metrics';
import { DATABASE } from '../database/database.tokens';

@Injectable()
export class MetricsService {
  constructor(@Inject(DATABASE) private readonly db: DatabaseClient) {}

  async metrics(): Promise<string> {
    const result = await this.db.execute(sql`
      SELECT
        count(*) FILTER (WHERE published_at IS NULL) AS unpublished_count,
        coalesce(extract(epoch FROM now() - min(occurred_at) FILTER (WHERE published_at IS NULL)), 0) AS oldest_unpublished_age_seconds,
        coalesce((SELECT extract(epoch FROM now() - min(started_at))
          FROM provisioning.tenant_provisioning WHERE status <> 'COMPLETED'), 0) AS provisioning_lag_seconds
      FROM integration.outbox
    `);
    const row = result.rows[0] as
      | {
          unpublished_count: string;
          oldest_unpublished_age_seconds: string;
          provisioning_lag_seconds: string;
        }
      | undefined;
    eventDeliveryMetrics.unpublishedCount.set(Number(row?.unpublished_count ?? 0));
    eventDeliveryMetrics.oldestUnpublishedAge.set(Number(row?.oldest_unpublished_age_seconds ?? 0));
    eventDeliveryMetrics.provisioningLag.set(Number(row?.provisioning_lag_seconds ?? 0));
    return eventDeliveryMetrics.registry.metrics();
  }
}
