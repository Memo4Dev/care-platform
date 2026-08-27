import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: NestFastifyApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Care Platform API')
    .setDescription(
      'M1/M2/M3/M4 SaaS Foundation — Platform Admin, Tenant Admin, Identity, Subscriptions, Entitlements, Provisioning, Catalog, Pricing, Inventory, Purchasing',
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
    .addTag('Catalog', 'Products, variants, categories, units, conversions, packaging, barcodes')
    .addTag('Pricing', 'Price books, entries, promotions, coupons, quotes, snapshots')
    .addTag(
      'Inventory',
      'Stock positions, reservations, allocations, transfers, adjustments, FIFO layers',
    )
    .addTag('Purchasing', 'Suppliers, purchase orders, goods receipts, purchasing costs')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });
}
