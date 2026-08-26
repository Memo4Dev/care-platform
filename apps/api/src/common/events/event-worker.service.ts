import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  assertIntegrationEventEnvelope,
  type IntegrationEventEnvelope,
} from './integration-envelope';
import { ProvisioningRetryConsumer } from '../../modules/provisioning/application/provisioning-retry.consumer';

@Injectable()
export class EventWorkerService {
  constructor(private readonly provisioningRetry: ProvisioningRetryConsumer) {}

  async process(job: Job<IntegrationEventEnvelope>): Promise<void> {
    const event = job.data;
    assertIntegrationEventEnvelope(event);
    if (event.eventType === 'provisioning.provisioning-retry-requested') {
      await this.provisioningRetry.consume(event);
      return;
    }
    // The outbox is shared infrastructure. An unknown event is intentionally
    // failed rather than acknowledged: its owning context must register a consumer.
    throw new Error(`No worker consumer is registered for ${event.eventType}.`);
  }
}
