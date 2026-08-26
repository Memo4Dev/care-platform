import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import {
  categories,
  productVariants,
  products,
  unitDefinitions,
  type DatabaseClient,
} from '@commerce-platform/database';
import { PlatformError } from '@commerce-platform/contracts';
import { TenantBearerGuard, type AuthenticatedRequest } from '../../common/auth/http-auth.guards';
import type { OrganizationUserPrincipal } from '../../common/auth/authenticated-principal';
import { correlationIdFor } from '../../common/http/correlation';
import { DATABASE } from '../database/database.tokens';
import { IDENTITY_CONTRACTS, type IdentityContracts } from '../identity/contracts';
import { CatalogService } from './application/catalog.service';

// ---------------------------------------------------------------------------
// Zod validation schemas
// ---------------------------------------------------------------------------

const productCreate = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
  })
  .strict();

const productUpdate = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
  })
  .strict();

const variantCreate = z
  .object({
    name: z.string().trim().min(1).max(200),
    sku: z.string().trim().min(1).max(80),
    barcode: z.string().trim().min(1).max(120).optional().nullable(),
    baseUnitId: z.string().uuid(),
    categoryId: z.string().uuid().optional().nullable(),
  })
  .strict();

const variantUpdate = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    sku: z.string().trim().min(1).max(80).optional(),
    barcode: z.string().trim().min(1).max(120).optional().nullable(),
    categoryId: z.string().uuid().optional().nullable(),
  })
  .strict();

const categoryCreate = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    parentId: z.string().uuid().optional().nullable(),
    sortOrder: z.number().int().nonnegative().optional(),
  })
  .strict();

const categoryUpdate = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    sortOrder: z.number().int().nonnegative().optional(),
  })
  .strict();

const unitCreate = z
  .object({
    name: z.string().trim().min(1).max(100),
    symbol: z.string().trim().min(1).max(20),
    isBaseUnit: z.boolean().optional(),
  })
  .strict();

const conversionCreate = z
  .object({
    fromUnitId: z.string().uuid(),
    toUnitId: z.string().uuid(),
    factor: z.string().trim().min(1),
  })
  .strict();

const barcodeAdd = z
  .object({
    variantId: z.string().uuid(),
    barcode: z.string().trim().min(1).max(120),
    packagingDefinitionId: z.string().uuid().optional().nullable(),
  })
  .strict();

const packagingCreate = z
  .object({
    name: z.string().trim().min(1).max(200),
    unitId: z.string().uuid(),
    parentId: z.string().uuid().optional().nullable(),
    factor: z.string().trim().min(1).optional(),
    sortOrder: z.number().int().nonnegative().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * Admin HTTP controller for the Catalog bounded context.
 *
 * Follows the exact pattern of TenantAdminController (organization module):
 * - TenantBearerGuard for auth
 * - Direct DB queries for reads
 * - Service layer for writes (transactional outbox)
 * - Zod validation for all request bodies
 * - Identity contract for authorization
 */
@Controller('/api/v1/admin/catalog')
@UseGuards(TenantBearerGuard)
@ApiTags('Catalog')
@ApiBearerAuth('platform-bearer')
export class CatalogAdminController {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(CatalogService) private readonly catalogService: CatalogService,
    @Inject(IDENTITY_CONTRACTS) private readonly identity: IdentityContracts,
  ) {}

  // -------------------------------------------------------------------------
  // Products
  // -------------------------------------------------------------------------

  @Get('products')
  @ApiOperation({ summary: 'List products for the tenant' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Max items (1–100, default 50)',
  })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Pagination offset' })
  @ApiResponse({ status: 200, description: 'Paginated product list' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  async listProducts(
    @Req() request: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'catalog.read');
    const rows = await this.db
      .select({
        id: products.id,
        organizationId: products.organizationId,
        name: products.name,
        description: products.description,
        status: products.status,
        version: products.version,
      })
      .from(products)
      .where(eq(products.organizationId, principal.organizationId))
      .orderBy(asc(products.createdAt))
      .limit(limit ? Math.min(parseInt(limit, 10) || 50, 100) : 50)
      .offset(offset ? Math.max(parseInt(offset, 10) || 0, 0) : 0);

    return { data: rows.map(toProductJson) };
  }

  @Post('products')
  @ApiOperation({ summary: 'Create a new product' })
  @ApiResponse({ status: 201, description: 'Product created' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async createProduct(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const principal = this.principal(request);
    await this.require(principal, request, 'catalog.write');
    const input = productCreate.parse(body);
    const result = await this.catalogService.createProduct({
      organizationId: principal.organizationId,
      name: input.name,
      description: input.description,
    });
    return result.product;
  }

  @Patch('products/:id')
  @ApiOperation({ summary: 'Update product metadata (name, description)' })
  @ApiResponse({ status: 200, description: 'Product updated' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async updateProduct(
    @Req() request: AuthenticatedRequest,
    @Param('id') productId: string,
    @Body() body: unknown,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'catalog.write');
    const input = productUpdate.parse(body);
    const result = await this.catalogService.updateProduct({
      organizationId: principal.organizationId,
      productId,
      name: input.name,
      description: input.description,
    });
    return result.product;
  }

  @Post('products/:id/variants')
  @ApiOperation({ summary: 'Add a sellable variant to a product' })
  @ApiResponse({ status: 201, description: 'Variant added' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict or SKU uniqueness violation' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async addVariant(
    @Req() request: AuthenticatedRequest,
    @Param('id') productId: string,
    @Body() body: unknown,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'catalog.write');
    this.requireIdempotencyKey(request);
    const input = variantCreate.parse(body);
    const result = await this.catalogService.addVariant({
      organizationId: principal.organizationId,
      productId,
      name: input.name,
      sku: input.sku,
      barcode: input.barcode,
      baseUnitId: input.baseUnitId,
      categoryId: input.categoryId,
    });
    return result.product;
  }

  @Get('products/:id/variants')
  @ApiOperation({ summary: 'List variants for a product' })
  @ApiResponse({ status: 200, description: 'Variant list' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async listVariants(@Req() request: AuthenticatedRequest, @Param('id') productId: string) {
    const principal = this.principal(request);
    await this.require(principal, request, 'catalog.read');
    const rows = await this.db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
      .orderBy(asc(productVariants.createdAt));

    const filtered = rows.filter((row) => row.organizationId === principal.organizationId);
    return { data: filtered.map(toVariantJson) };
  }

  @Patch('variants/:id')
  @ApiOperation({ summary: 'Update variant metadata (name, sku, barcode, categoryId)' })
  @ApiResponse({ status: 200, description: 'Variant updated' })
  @ApiResponse({ status: 404, description: 'Variant not found' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async updateVariant(
    @Req() request: AuthenticatedRequest,
    @Param('id') variantId: string,
    @Body() body: unknown,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'catalog.write');
    const input = variantUpdate.parse(body);

    // Resolve productId from the variant row
    const [variantRow] = await this.db
      .select({ productId: productVariants.productId })
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
      .limit(1);

    if (!variantRow) {
      throw PlatformError.notFound(`Variant ${variantId} was not found.`, {
        details: { variantId },
      });
    }

    const result = await this.catalogService.updateVariant({
      organizationId: principal.organizationId,
      productId: variantRow.productId,
      variantId,
      name: input.name,
      sku: input.sku,
      barcode: input.barcode,
      categoryId: input.categoryId,
    });
    return result.product;
  }

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------

  @Get('categories')
  @ApiOperation({ summary: 'List categories for the tenant' })
  @ApiResponse({ status: 200, description: 'Category list sorted by sortOrder' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  async listCategories(@Req() request: AuthenticatedRequest) {
    const principal = this.principal(request);
    await this.require(principal, request, 'catalog.read');
    const rows = await this.db
      .select()
      .from(categories)
      .where(eq(categories.organizationId, principal.organizationId))
      .orderBy(asc(categories.sortOrder));

    return { data: rows.map(toCategoryJson) };
  }

  @Post('categories')
  @ApiOperation({ summary: 'Create a category (optionally nested under a parent)' })
  @ApiResponse({ status: 201, description: 'Category created' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async createCategory(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const principal = this.principal(request);
    await this.require(principal, request, 'catalog.write');
    const input = categoryCreate.parse(body);
    const result = await this.catalogService.createCategory({
      organizationId: principal.organizationId,
      name: input.name,
      description: input.description,
      parentId: input.parentId,
      sortOrder: input.sortOrder,
    });
    return result.category;
  }

  @Patch('categories/:id')
  @ApiOperation({ summary: 'Update category metadata' })
  @ApiResponse({ status: 200, description: 'Category updated' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async updateCategory(
    @Req() request: AuthenticatedRequest,
    @Param('id') categoryId: string,
    @Body() body: unknown,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'catalog.write');
    const input = categoryUpdate.parse(body);
    const result = await this.catalogService.updateCategory({
      organizationId: principal.organizationId,
      categoryId,
      name: input.name,
      description: input.description,
      sortOrder: input.sortOrder,
    });
    return result.category;
  }

  // -------------------------------------------------------------------------
  // Units
  // -------------------------------------------------------------------------

  @Get('units')
  @ApiOperation({ summary: 'List unit definitions for the tenant' })
  @ApiResponse({ status: 200, description: 'Unit definition list' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  async listUnits(@Req() request: AuthenticatedRequest) {
    const principal = this.principal(request);
    await this.require(principal, request, 'catalog.read');
    const rows = await this.db
      .select()
      .from(unitDefinitions)
      .where(eq(unitDefinitions.organizationId, principal.organizationId))
      .orderBy(asc(unitDefinitions.createdAt));

    return { data: rows.map(toUnitJson) };
  }

  @Post('units')
  @ApiOperation({ summary: 'Create a unit definition (e.g. Piece, Kg, Box)' })
  @ApiResponse({ status: 201, description: 'Unit created' })
  @ApiResponse({ status: 409, description: 'Duplicate name+symbol within org' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async createUnit(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const principal = this.principal(request);
    await this.require(principal, request, 'catalog.write');
    const input = unitCreate.parse(body);
    const result = await this.catalogService.createUnit({
      organizationId: principal.organizationId,
      name: input.name,
      symbol: input.symbol,
      isBaseUnit: input.isBaseUnit,
    });
    return result.unit;
  }

  // -------------------------------------------------------------------------
  // Unit conversions
  // -------------------------------------------------------------------------

  @Post('unit-conversions')
  @ApiOperation({ summary: 'Create a unit conversion (e.g. 1 Box = 12 Pieces)' })
  @ApiResponse({ status: 201, description: 'Conversion created' })
  @ApiResponse({ status: 409, description: 'Duplicate from+to pair or invalid factor' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async createConversion(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const principal = this.principal(request);
    await this.require(principal, request, 'catalog.write');
    this.requireIdempotencyKey(request);
    const input = conversionCreate.parse(body);
    const result = await this.catalogService.createConversion({
      organizationId: principal.organizationId,
      fromUnitId: input.fromUnitId,
      toUnitId: input.toUnitId,
      factor: input.factor,
    });
    return { id: result.conversionId };
  }

  // -------------------------------------------------------------------------
  // Barcodes
  // -------------------------------------------------------------------------

  @Post('barcodes')
  @ApiOperation({ summary: 'Add a barcode to a variant (org-wide unique)' })
  @ApiResponse({ status: 201, description: 'Barcode added' })
  @ApiResponse({
    status: 409,
    description: 'Barcode already exists in org or idempotency conflict',
  })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async addBarcode(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const principal = this.principal(request);
    await this.require(principal, request, 'catalog.write');
    this.requireIdempotencyKey(request);
    const input = barcodeAdd.parse(body);
    const result = await this.catalogService.addBarcode({
      organizationId: principal.organizationId,
      variantId: input.variantId,
      barcode: input.barcode,
      packagingDefinitionId: input.packagingDefinitionId,
    });
    return { id: result.barcodeId };
  }

  // -------------------------------------------------------------------------
  // Packaging
  // -------------------------------------------------------------------------

  @Post('packaging-definitions')
  @ApiOperation({ summary: 'Create a packaging definition (e.g. Inner Box, Outer Carton)' })
  @ApiResponse({ status: 201, description: 'Packaging definition created' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async createPackagingDefinition(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const principal = this.principal(request);
    await this.require(principal, request, 'catalog.write');
    this.requireIdempotencyKey(request);
    const input = packagingCreate.parse(body);
    const result = await this.catalogService.createPackagingDefinition({
      organizationId: principal.organizationId,
      name: input.name,
      unitId: input.unitId,
      parentId: input.parentId,
      factor: input.factor,
      sortOrder: input.sortOrder,
    });
    return result.packaging;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private principal(request: AuthenticatedRequest): OrganizationUserPrincipal {
    if (!request.principal || request.principal.type !== 'ORGANIZATION_USER')
      throw PlatformError.permissionDenied();
    return request.principal as OrganizationUserPrincipal;
  }

  private async require(
    principal: OrganizationUserPrincipal,
    request: AuthenticatedRequest,
    permissionCode: string,
  ) {
    await this.identity
      .authorize({
        userId: principal.organizationUserId,
        organizationId: principal.organizationId,
        permissionCode,
        correlationId: correlationIdFor(request),
      })
      .then((decision) => {
        if (!decision.allowed) throw PlatformError.permissionDenied();
      });
  }

  private requireIdempotencyKey(request: AuthenticatedRequest): string {
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !key.trim() || key.length > 255)
      throw PlatformError.validationFailed('Idempotency-Key is required for mutation requests.', {
        details: { field: 'Idempotency-Key' },
      });
    return key;
  }
}

// ---------------------------------------------------------------------------
// JSON mappers for list endpoints
// ---------------------------------------------------------------------------

function toProductJson(row: {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description ?? '',
    status: row.status,
    version: row.version,
  };
}

function toVariantJson(row: {
  id: string;
  organizationId: string;
  productId: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  baseUnitId: string;
  categoryId: string | null;
  status: string;
  version: number;
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    productId: row.productId,
    name: row.name,
    sku: row.sku ?? '',
    barcode: row.barcode,
    baseUnitId: row.baseUnitId,
    categoryId: row.categoryId,
    status: row.status,
    version: row.version,
  };
}

function toCategoryJson(row: {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description ?? '',
    parentId: row.parentId,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    version: row.version,
  };
}

function toUnitJson(row: {
  id: string;
  organizationId: string;
  name: string;
  symbol: string;
  isBaseUnit: boolean;
  version: number;
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    symbol: row.symbol,
    isBaseUnit: row.isBaseUnit,
    version: row.version,
  };
}
