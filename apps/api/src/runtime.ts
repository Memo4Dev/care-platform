import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { AppModule } from './app.module';
import { readRedisConfig } from './common/events/delivery-config';
import { EventWorkerService } from './common/events/event-worker.service';
import {
  INTEGRATION_EVENT_QUEUE,
  OutboxRelayService,
  createIntegrationQueue,
} from './common/events/outbox-relay.service';

const RELAY_INTERVAL_MS = 1_000;

export async function bootstrapRelay(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const queue = createIntegrationQueue(readRedisConfig());
  const relay = app.get(OutboxRelayService);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(interval);
    await queue.close();
    await app.close();
  };
  const run = () => relay.relayOnce(queue).catch(() => undefined);
  const interval = setInterval(run, RELAY_INTERVAL_MS);
  await run();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

export async function bootstrapWorker(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const consumer = app.get(EventWorkerService);
  const worker = new Worker(INTEGRATION_EVENT_QUEUE, (job) => consumer.process(job), {
    connection: readRedisConfig(),
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
  });
  const stop = async () => {
    await worker.close();
    await app.close();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
