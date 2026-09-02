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
  @ApiResponse({ status: 201, description: 'Sale created' })
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
