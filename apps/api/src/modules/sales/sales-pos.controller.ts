import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PlatformError } from '@commerce-platform/contracts';
import { z } from 'zod';

import { PosOperatorGuard, type AuthenticatedRequest } from '../../common/auth/http-auth.guards';
import {
  assertTrustedOrganizationUserPrincipal,
  type OrganizationUserPrincipal,
} from '../../common/auth/authenticated-principal';
import { correlationIdFor } from '../../common/http/correlation';
import { IDENTITY_CONTRACTS, type IdentityContracts } from '../identity/contracts';
import { SalesService } from './application/sales.service';
import { CART_CONTRACTS, type CartContracts } from '../cart/contracts';

const createSale = z
  .object({
    cartId: z.string().uuid(),
    warehouseId: z.string().uuid().optional(),
    priceType: z.enum(['CASH', 'WHOLESALE', 'CREDIT', 'ONLINE']).default('CASH'),
  })
  .strict();
const cancelSale = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

const errorEnvelope = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'correlationId'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: { type: 'object', additionalProperties: true },
        correlationId: { type: 'string' },
      },
    },
  },
};

const saleSuccess = {
  type: 'object',
  required: ['data'],
  properties: {
    data: {
      type: 'object',
      required: ['id', 'saleNumber', 'status', 'branchId', 'total', 'currency', 'items'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        organizationId: { type: 'string', format: 'uuid' },
        branchId: { type: 'string', format: 'uuid' },
        warehouseId: { type: 'string', format: 'uuid', nullable: true },
        cartId: { type: 'string', format: 'uuid' },
        cartVersion: { type: 'number' },
        saleNumber: { type: 'string' },
        status: { type: 'string', enum: ['PENDING_PAYMENT', 'COMPLETED', 'CANCELLED'] },
        customerId: { type: 'string', format: 'uuid', nullable: true },
        operatorId: { type: 'string', format: 'uuid' },
        priceType: { type: 'string', enum: ['CASH', 'WHOLESALE', 'CREDIT', 'ONLINE'] },
        currency: { type: 'string' },
        subtotal: { type: 'string' },
        discountTotal: { type: 'string' },
        taxTotal: { type: 'string' },
        total: { type: 'string' },
        inventoryReservationId: { type: 'string', format: 'uuid' },
        completedAt: { type: 'string', nullable: true },
        cancelledAt: { type: 'string', nullable: true },
        cancellationReason: { type: 'string', nullable: true },
        createdAt: { type: 'string' },
        updatedAt: { type: 'string' },
        version: { type: 'number' },
        items: { type: 'array', items: { type: 'object' } },
      },
    },
  },
};

@ApiTags('POS Sales')
@ApiBearerAuth('tenant-bearer')
@Controller('/api/v1/pos/sales')
export class SalesPosController {
  constructor(
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject(IDENTITY_CONTRACTS) private readonly identity: IdentityContracts,
    @Inject(CART_CONTRACTS) private readonly carts: CartContracts,
  ) {}

  @Post()
  @UseGuards(PosOperatorGuard)
  @ApiOperation({ summary: 'Checkout Cart to immutable PENDING_PAYMENT Sale' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'If-Match', required: true, description: 'Expected Cart version' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['cartId'],
      properties: {
        cartId: { type: 'string', format: 'uuid' },
        warehouseId: { type: 'string', format: 'uuid' },
        priceType: { type: 'string', enum: ['CASH', 'WHOLESALE', 'CREDIT', 'ONLINE'] },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Sale created', schema: saleSuccess })
  @ApiResponse({ status: 401, description: 'Authentication required', schema: errorEnvelope })
  @ApiResponse({
    status: 403,
    description: 'Permission sales.create denied',
    schema: errorEnvelope,
  })
  @ApiResponse({
    status: 404,
    description: 'Cart, variant or product not found',
    schema: errorEnvelope,
  })
  @ApiResponse({
    status: 409,
    description: 'Cart already checked out or version conflict',
    schema: errorEnvelope,
  })
  @ApiResponse({ status: 422, description: 'Invalid body or headers', schema: errorEnvelope })
  async create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const principal = this.principal(request);
    const input = createSale.parse(body);
    const cartVersion = this.requireVersion(request);
    const cart = await this.carts.getCart(principal.organizationId, input.cartId);
    if (!cart) throw PlatformError.notFound('Cart not found.');
    await this.requirePermission(
      principal,
      request,
      'sales.create',
      principal.organizationId,
      cart.branchId,
    );
    const result = await this.sales.createSale({
      organizationId: principal.organizationId,
      cartId: input.cartId,
      cartVersion,
      warehouseId: input.warehouseId,
      priceType: input.priceType,
      idempotencyKey: this.requireIdempotencyKey(request),
      actorId: principal.organizationUserId,
      correlationId: correlationIdFor(request),
      causationId: this.requireIdempotencyKey(request),
    });
    return { data: result };
  }

  @Get(':saleId')
  @UseGuards(PosOperatorGuard)
  @ApiOperation({ summary: 'Get Sale snapshot' })
  @ApiParam({ name: 'saleId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Sale snapshot', schema: saleSuccess })
  @ApiResponse({ status: 401, description: 'Authentication required', schema: errorEnvelope })
  @ApiResponse({ status: 403, description: 'Permission sales.read denied', schema: errorEnvelope })
  @ApiResponse({ status: 404, description: 'Sale not found', schema: errorEnvelope })
  async get(@Req() request: AuthenticatedRequest, @Param('saleId') saleId: string) {
    const principal = this.principal(request);
    const sale = await this.sales.getSale(principal.organizationId, saleId);
    if (!sale) throw PlatformError.notFound('Sale not found.');
    await this.requirePermission(
      principal,
      request,
      'sales.read',
      principal.organizationId,
      sale.branchId,
    );
    return { data: sale };
  }

  @Post(':saleId/cancel')
  @UseGuards(PosOperatorGuard)
  @ApiOperation({ summary: 'Cancel pending Sale' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiResponse({ status: 201, description: 'Sale cancelled', schema: saleSuccess })
  @ApiResponse({ status: 401, description: 'Authentication required', schema: errorEnvelope })
  @ApiResponse({
    status: 403,
    description: 'Permission sales.cancel denied',
    schema: errorEnvelope,
  })
  @ApiResponse({ status: 404, description: 'Sale not found', schema: errorEnvelope })
  @ApiResponse({
    status: 409,
    description: 'Completed Sale cannot be cancelled',
    schema: errorEnvelope,
  })
  @ApiResponse({ status: 422, description: 'Invalid body or headers', schema: errorEnvelope })
  async cancel(
    @Req() request: AuthenticatedRequest,
    @Param('saleId') saleId: string,
    @Body() body: unknown,
  ) {
    const principal = this.principal(request);
    const input = cancelSale.parse(body);
    const existing = await this.sales.getSale(principal.organizationId, saleId);
    if (!existing) throw PlatformError.notFound('Sale not found.');
    await this.requirePermission(
      principal,
      request,
      'sales.cancel',
      principal.organizationId,
      existing.branchId,
    );
    const sale = await this.sales.cancelSale({
      organizationId: principal.organizationId,
      saleId,
      reason: input.reason,
      idempotencyKey: this.requireIdempotencyKey(request),
      actorId: principal.organizationUserId,
      correlationId: correlationIdFor(request),
      causationId: this.requireIdempotencyKey(request),
    });
    return { data: sale };
  }

  private principal(request: AuthenticatedRequest): OrganizationUserPrincipal {
    assertTrustedOrganizationUserPrincipal(request.principal);
    return request.principal;
  }

  private requireIdempotencyKey(request: AuthenticatedRequest): string {
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !key.trim())
      throw PlatformError.validationFailed('Idempotency-Key is required.');
    return key.trim();
  }

  private requireVersion(request: AuthenticatedRequest): number {
    const value = request.headers['if-match'];
    if (typeof value !== 'string' || !/^\d+$/.test(value))
      throw PlatformError.validationFailed('If-Match must contain the expected Cart version.');
    return Number(value);
  }

  private async requirePermission(
    principal: OrganizationUserPrincipal,
    request: AuthenticatedRequest,
    permissionCode: 'sales.read' | 'sales.create' | 'sales.cancel',
    organizationId: string,
    branchId?: string,
  ) {
    const decision = await this.identity.authorize({
      userId: principal.organizationUserId,
      organizationId,
      permissionCode,
      branchId,
      correlationId: correlationIdFor(request),
    });
    if (decision.allowed) return;
    if (decision.reason === 'BRANCH_SCOPE_EXCLUDED')
      throw PlatformError.branchAccessDenied('Branch access denied.');
    throw PlatformError.permissionDenied(`Permission ${permissionCode} denied.`);
  }
}
