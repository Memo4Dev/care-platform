import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: NestFastifyApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Care Platform API')
    .setDescription(
      'M1 SaaS Foundation — Platform Admin, Tenant Admin, Identity, Subscriptions, Entitlements, Provisioning',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Supabase JWT for platform or tenant authorization',
      },
      'platform-bearer',
    )
    .addTag('Health', 'Liveness/readiness probes')
    .addTag('Platform Admin', 'Platform-wide tenant, plan, subscription management')
    .addTag('Tenant Admin', 'Organization-scoped administration')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });
}
