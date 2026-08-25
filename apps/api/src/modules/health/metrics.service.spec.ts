import { describe, expect, it, vi } from 'vitest';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('renders the scrapeable delivery and provisioning registry metrics', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue({
        rows: [
          {
            unpublished_count: '3',
            oldest_unpublished_age_seconds: '42',
            provisioning_lag_seconds: '9',
          },
        ],
      }),
    };

    const output = await new MetricsService(db as never).metrics();

    expect(output).toContain('outbox_unpublished_count 3');
    expect(output).toContain('outbox_oldest_unpublished_age_seconds 42');
    expect(output).toContain('outbox_publish_failures_total');
    expect(output).toContain('bullmq_failed_jobs');
    expect(output).toContain('tenant_provisioning_lag_seconds 9');
  });
});
