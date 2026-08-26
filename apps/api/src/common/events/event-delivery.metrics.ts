import { Counter, Gauge, Histogram, Registry } from 'prom-client';

/** Dedicated registry prevents duplicate global metric registration in tests. */
export class EventDeliveryMetrics {
  readonly registry = new Registry();
  readonly relayPublished = new Counter({
    name: 'outbox_events_published_total',
    help: 'Outbox events safely handed to BullMQ.',
    labelNames: ['event_type'] as const,
    registers: [this.registry],
  });
  readonly relayFailures = new Counter({
    name: 'outbox_publish_failures_total',
    help: 'Failed attempts to publish outbox events.',
    labelNames: ['event_type'] as const,
    registers: [this.registry],
  });
  readonly unpublishedCount = new Gauge({
    name: 'outbox_unpublished_count',
    help: 'Outbox events not yet durably handed to BullMQ.',
    registers: [this.registry],
  });
  readonly oldestUnpublishedAge = new Gauge({
    name: 'outbox_oldest_unpublished_age_seconds',
    help: 'Age in seconds of the oldest unpublished outbox event.',
    registers: [this.registry],
  });
  readonly bullmqFailedJobs = new Gauge({
    name: 'bullmq_failed_jobs',
    help: 'Retained failed BullMQ integration-event jobs.',
    registers: [this.registry],
  });
  readonly provisioningLag = new Gauge({
    name: 'tenant_provisioning_lag_seconds',
    help: 'Age in seconds of the oldest incomplete tenant provisioning process.',
    registers: [this.registry],
  });
  readonly consumerCompleted = new Counter({
    name: 'event_consumer_completed_total',
    help: 'Durably completed event consumer deliveries.',
    labelNames: ['consumer', 'event_type'] as const,
    registers: [this.registry],
  });
  readonly consumerDuration = new Histogram({
    name: 'event_consumer_duration_seconds',
    help: 'Event consumer processing duration after durable lease claim.',
    labelNames: ['consumer', 'event_type'] as const,
    registers: [this.registry],
  });
}

export const eventDeliveryMetrics = new EventDeliveryMetrics();
