import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { priceBooks, priceEntries, promotions, coupons } from '@commerce-platform/database';
import type { DatabaseClient, PriceType, Channel } from '@commerce-platform/database';
import { PlatformError } from '@commerce-platform/contracts';
import { TenantBearerGuard, type AuthenticatedRequest } from '../../common/auth/http-auth.guards';
import type { OrganizationUserPrincipal } from '../../common/auth/authenticated-principal';
import { correlationIdFor } from '../../common/http/correlation';
import { DATABASE } from '../database/database.tokens';
import { IDENTITY_CONTRACTS, type IdentityContracts } from '../identity/contracts';
import { PricingService } from './application/pricing.service';

// ---------------------------------------------------------------------------
// Zod schemas for request validation
// ---------------------------------------------------------------------------

const text = z.string().trim().min(1).max(200);

const priceTypeEnum = z.enum(['CASH', 'WHOLESALE', 'CREDIT', 'ONLINE']);
const channelEnum = z.enum(['POS', 'ONLINE', 'MOBILE', 'WHOLESALE']);
const promotionTypeEnum = z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'BUY_X_GET_Y']);
const promotionTargetEnum = z.enum(['PRODUCT', 'VARIANT', 'CATEGORY', 'ORDER']);
const couponTypeEnum = z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING']);

const priceBookCreate = z
  .object({
    name: text,
    description: text.optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

const priceBookUpdate = z
  .object({
    name: text.optional(),
    description: z.string().max(500).optional(),
  })
  .strict();

const priceEntryCreate = z
  .object({
    priceBookId: z.string().uuid(),
    variantId: z.string().uuid(),
    unitId: z.string().uuid(),
    priceType: priceTypeEnum,
    channel: channelEnum.default('POS'),
    branchId: z.string().uuid().nullable().optional(),
    amount: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Amount must be a positive decimal string'),
    effectiveFrom: z.string().optional(),
    effectiveTo: z.string().nullable().optional(),
  })
  .strict();

const priceEntryUpdate = z
  .object({
    amount: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Amount must be a positive decimal string'),
  })
  .strict();

const promotionCreate = z
  .object({
    name: text,
    description: text.optional(),
    type: promotionTypeEnum,
    target: promotionTargetEnum,
    value: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Value must be a numeric string'),
    minQuantity: z.number().int().positive().nullable().optional(),
    maxQuantity: z.number().int().positive().nullable().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  })
  .strict();

const promotionUpdate = z
  .object({
    isActive: z.boolean().optional(),
  })
  .strict();

const couponCreate = z
  .object({
    code: text,
    description: text.optional(),
    type: couponTypeEnum,
    value: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Value must be a numeric string'),
    promotionId: z.string().uuid(),
    maxUses: z.number().int().positive().nullable().optional(),
    minOrderAmount: z
      .string()
      .regex(/^\d+(\.\d{1,4})?$/)
      .nullable()
      .optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  })
  .strict();

const quoteRequest = z
  .object({
    variantId: z.string().uuid(),
    unitId: z.string().uuid(),
    priceType: priceTypeEnum,
    channel: channelEnum,
    branchId: z.string().uuid().nullable().optional(),
    effectiveDate: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('/api/v1/admin/pricing')
@UseGuards(TenantBearerGuard)
@ApiTags('Pricing')
@ApiBearerAuth('platform-bearer')
export class PricingAdminController {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(IDENTITY_CONTRACTS) private readonly identity: IdentityContracts,
  ) {}

  // ---------------------------------------------------------------------------
  // Price Books
  // ---------------------------------------------------------------------------

  @Post('price-books')
  @ApiOperation({ summary: 'Create a price book (e.g. Retail, Wholesale)' })
  @ApiResponse({ status: 201, description: 'Price book created' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async createPriceBook(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const principal = this.principal(request);
    await this.require(principal, request, 'pricing.create');
    const input = priceBookCreate.parse(body);
    const result = await this.pricing.createPriceBook({
      organizationId: principal.organizationId,
      name: input.name,
      description: input.description,
      isDefault: input.isDefault,
    });
    return { data: result };
  }

  @Get('price-books')
  @ApiOperation({ summary: 'List price books for the tenant' })
  @ApiResponse({ status: 200, description: 'Price book list' })
  async listPriceBooks(@Req() request: AuthenticatedRequest) {
    const principal = this.principal(request);
    await this.require(principal, request, 'pricing.view');
    const rows = await this.db
      .select({
        id: priceBooks.id,
        name: priceBooks.name,
        description: priceBooks.description,
        isDefault: priceBooks.isDefault,
        isActive: priceBooks.isActive,
        version: priceBooks.version,
      })
      .from(priceBooks)
      .where(eq(priceBooks.organizationId, principal.organizationId))
      .orderBy(asc(priceBooks.createdAt));

    return { data: rows };
  }

  @Patch('price-books/:id')
  @ApiOperation({ summary: 'Update price book name or description' })
  @ApiResponse({ status: 200, description: 'Price book updated' })
  @ApiResponse({ status: 404, description: 'Price book not found' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  async updatePriceBook(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'pricing.edit');
    this.requireIdempotencyKey(request);
    const input = priceBookUpdate.parse(body);

    // Direct update for non-aggregate-changing fields (name, description)
    // Full aggregate path for version-conflict protection
    const aggregate = await this.db.select().from(priceBooks).where(eq(priceBooks.id, id)).limit(1);

    if (!aggregate[0] || aggregate[0].organizationId !== principal.organizationId) {
      throw PlatformError.notFound(`Price book ${id} was not found.`);
    }

    await this.db
      .update(priceBooks)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(priceBooks.id, id));

    return { data: { id, ...input } };
  }

  @Post('price-books/:id/default')
  @ApiOperation({ summary: 'Set a price book as the tenant default (clears previous default)' })
  @ApiResponse({ status: 200, description: 'Default price book updated' })
  @ApiResponse({ status: 404, description: 'Price book not found' })
  async setDefaultPriceBook(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const principal = this.principal(request);
    await this.require(principal, request, 'pricing.edit');
    this.requireIdempotencyKey(request);
    const result = await this.pricing.setDefaultPriceBook({
      organizationId: principal.organizationId,
      priceBookId: id,
    });
    return { data: result };
  }

  // ---------------------------------------------------------------------------
  // Price Entries
  // ---------------------------------------------------------------------------

  @Post('price-entries')
  @ApiOperation({
    summary: 'Create a price entry for a variant/unit/priceType/channel/branch dimension',
  })
  @ApiResponse({ status: 201, description: 'Price entry created' })
  @ApiResponse({ status: 409, description: 'Duplicate dimension or idempotency conflict' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async createPriceEntry(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const principal = this.principal(request);
    await this.require(principal, request, 'pricing.create');
    this.requireIdempotencyKey(request);
    const input = priceEntryCreate.parse(body);
    const result = await this.pricing.createPriceEntry({
      organizationId: principal.organizationId,
      priceBookId: input.priceBookId,
      variantId: input.variantId,
      unitId: input.unitId,
      priceType: input.priceType as PriceType,
      channel: input.channel as Channel,
      branchId: input.branchId,
      amount: input.amount,
      effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : null,
      effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
    });
    return { data: result };
  }

  @Get('price-entries')
  @ApiOperation({ summary: 'List price entries for the tenant' })
  @ApiResponse({ status: 200, description: 'Price entry list' })
  async listPriceEntries(@Req() request: AuthenticatedRequest) {
    const principal = this.principal(request);
    await this.require(principal, request, 'pricing.view');
    const rows = await this.db
      .select()
      .from(priceEntries)
      .where(eq(priceEntries.organizationId, principal.organizationId))
      .orderBy(asc(priceEntries.createdAt));

    return { data: rows };
  }

  @Patch('price-entries/:id')
  @ApiOperation({ summary: 'Update a price entry amount' })
  @ApiResponse({ status: 200, description: 'Price entry updated' })
  @ApiResponse({ status: 404, description: 'Price entry not found' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  async updatePriceEntry(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'pricing.edit');
    this.requireIdempotencyKey(request);
    const input = priceEntryUpdate.parse(body);
    const result = await this.pricing.updatePriceEntry({
      organizationId: principal.organizationId,
      entryId: id,
      amount: input.amount,
    });
    return { data: result };
  }

  // ---------------------------------------------------------------------------
  // Promotions
  // ---------------------------------------------------------------------------

  @Post('promotions')
  @ApiOperation({ summary: 'Create a promotion (percentage, fixed amount, or buy-X-get-Y)' })
  @ApiResponse({ status: 201, description: 'Promotion created' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async createPromotion(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const principal = this.principal(request);
    await this.require(principal, request, 'pricing.create');
    this.requireIdempotencyKey(request);
    const input = promotionCreate.parse(body);
    const result = await this.pricing.createPromotion({
      organizationId: principal.organizationId,
      name: input.name,
      type: input.type,
      target: input.target,
      value: input.value,
      minQuantity: input.minQuantity,
      maxQuantity: input.maxQuantity,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
    });
    return { data: result };
  }

  @Get('promotions')
  @ApiOperation({ summary: 'List promotions for the tenant' })
  @ApiResponse({ status: 200, description: 'Promotion list' })
  async listPromotions(@Req() request: AuthenticatedRequest) {
    const principal = this.principal(request);
    await this.require(principal, request, 'pricing.view');
    const rows = await this.db
      .select()
      .from(promotions)
      .where(eq(promotions.organizationId, principal.organizationId))
      .orderBy(asc(promotions.createdAt));

    return { data: rows };
  }

  @Patch('promotions/:id')
  @ApiOperation({ summary: 'Deactivate a promotion' })
  @ApiResponse({ status: 200, description: 'Promotion deactivated' })
  @ApiResponse({ status: 404, description: 'Promotion not found' })
  async updatePromotion(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'pricing.edit');
    this.requireIdempotencyKey(request);
    const input = promotionUpdate.parse(body);

    if (input.isActive === false) {
      const result = await this.pricing.deactivatePromotion({
        organizationId: principal.organizationId,
        promotionId: id,
      });
      return { data: result };
    }

    return { data: { id, ...input } };
  }

  // ---------------------------------------------------------------------------
  // Coupons
  // ---------------------------------------------------------------------------

  @Post('coupons')
  @ApiOperation({ summary: 'Create a coupon code (linked to optional promotion)' })
  @ApiResponse({ status: 201, description: 'Coupon created' })
  @ApiResponse({ status: 409, description: 'Duplicate code within org' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async createCoupon(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const principal = this.principal(request);
    await this.require(principal, request, 'pricing.create');
    this.requireIdempotencyKey(request);
    const input = couponCreate.parse(body);
    const result = await this.pricing.createCoupon({
      organizationId: principal.organizationId,
      code: input.code,
      type: input.type,
      value: input.value,
      promotionId: input.promotionId,
      maxUses: input.maxUses,
      minOrderAmount: input.minOrderAmount,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
    });
    return { data: result };
  }

  @Get('coupons')
  @ApiOperation({ summary: 'List coupons for the tenant' })
  @ApiResponse({ status: 200, description: 'Coupon list' })
  async listCoupons(@Req() request: AuthenticatedRequest) {
    const principal = this.principal(request);
    await this.require(principal, request, 'pricing.view');
    const rows = await this.db
      .select()
      .from(coupons)
      .where(eq(coupons.organizationId, principal.organizationId))
      .orderBy(asc(coupons.createdAt));

    return { data: rows };
  }

  @Post('coupons/:id/redeem')
  @ApiOperation({ summary: 'Redeem a coupon' })
  @ApiResponse({ status: 200, description: 'Coupon redeemed' })
  @ApiResponse({ status: 404, description: 'Coupon not found' })
  @ApiResponse({ status: 409, description: 'Coupon expired or max uses reached' })
  async redeemCoupon(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const principal = this.principal(request);
    await this.require(principal, request, 'pricing.create');
    this.requireIdempotencyKey(request);
    const result = await this.pricing.redeemCoupon({
      organizationId: principal.organizationId,
      couponId: id,
    });
    return { data: result };
  }

  // ---------------------------------------------------------------------------
  // Price Quote (read-only)
  // ---------------------------------------------------------------------------

  @Post('quote')
  @ApiOperation({ summary: 'Resolve the best active price for a variant/unit/channel/dimension' })
  @ApiResponse({ status: 200, description: 'Resolved price quote' })
  @ApiResponse({ status: 404, description: 'No active price found for the given dimensions' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async resolvePriceQuote(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const principal = this.principal(request);
    await this.require(principal, request, 'pricing.view');
    const input = quoteRequest.parse(body);
    const quote = await this.pricing.resolvePriceQuote({
      organizationId: principal.organizationId,
      variantId: input.variantId,
      unitId: input.unitId,
      priceType: input.priceType as PriceType,
      channel: input.channel as Channel,
      branchId: input.branchId,
      effectiveDate: input.effectiveDate,
    });
    return { data: quote };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private principal(request: AuthenticatedRequest): OrganizationUserPrincipal {
    if (!request.principal || request.principal.type !== 'ORGANIZATION_USER')
      throw PlatformError.permissionDenied();
    return request.principal as OrganizationUserPrincipal;
  }

  private requireIdempotencyKey(request: AuthenticatedRequest): string {
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !key.trim() || key.length > 255)
      throw PlatformError.validationFailed('Idempotency-Key is required for mutation requests.', {
        details: { field: 'Idempotency-Key' },
      });
    return key;
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
}
