import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module';
import { assertSeparatedBearerAudiences } from './common/auth/auth-config';
import { readRuntimeRole } from './common/events/delivery-config';
import { PlatformErrorFilter } from './common/http/platform-error.filter';
import { correlationIdFor, type RequestWithCorrelation } from './common/http/correlation';
import { bootstrapRelay, bootstrapWorker } from './runtime';
import { setupSwagger } from './swagger';

export async function createApp(): Promise<NestFastifyApplication> {
  assertSeparatedBearerAudiences();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
    abortOnError: false,
  });
  app
    .getHttpAdapter()
    .getInstance()
    .addHook(
      'onRequest',
      (
        request: RequestWithCorrelation,
        reply: { header(name: string, value: string): void },
        done: () => void,
      ) => {
        request.correlationId =
          typeof request.headers['correlation-id'] === 'string'
            ? request.headers['correlation-id']
            : correlationIdFor(request);
        reply.header('Correlation-Id', request.correlationId);
        done();
      },
    );
  app.useGlobalFilters(new PlatformErrorFilter());
  return app;
}

export async function bootstrap(): Promise<NestFastifyApplication> {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3000);

  setupSwagger(app);
  await app.listen({ port, host: '0.0.0.0' });

  return app;
}

if (require.main === module) {
  const role = readRuntimeRole();
  const start = role === 'api' ? bootstrap : role === 'relay' ? bootstrapRelay : bootstrapWorker;
  start().catch((error: unknown) => {
    console.error(JSON.stringify({ level: 'error', message: startupErrorMessage(error) }));
    process.exit(1);
  });
}

function startupErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Runtime startup failed.';
  return message
    .replace(/(redis(?:s)?:\/\/[^:\s/]+:)[^@\s]+@/gi, '$1[REDACTED]@')
    .replace(/(password|token|secret)\s*[=:]\s*[^\s,]+/gi, '$1=[REDACTED]');
}
