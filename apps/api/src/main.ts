import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module';

export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });

  return app;
}

export async function bootstrap(): Promise<NestFastifyApplication> {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3000);

  await app.listen({ port, host: '0.0.0.0' });

  return app;
}

if (require.main === module) {
  bootstrap().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
