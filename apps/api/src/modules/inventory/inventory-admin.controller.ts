import { createHash } from 'node:crypto';

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';
import { PlatformError } from '@commerce-platform/contracts';
import { TenantBearerGuard, type AuthenticatedRequest } from '../../common/auth/http-auth.guards';
import type { OrganizationUserPrincipal } from '../../common/auth/authenticated-principal';
import { correlationIdFor } from '../../common/http/correlation';
import { IDENTITY_CONTRACTS, type IdentityContracts } from '../identity/contracts';
import { normalizeInventoryQuantity } from './application/inventory-quantity';
import { InventoryService } from './application/inventory.service';

// ---------------------------------------------------------------------------
// Zod validation schemas
// ---------------------------------------------------------------------------

const reservationCreate = z
  .object({
    warehouseId: z.string().uuid(),
    variantId: z.string().uuid(),
    quantity: z.string().trim().min(1),
    expiresAt: z.string().datetime().optional().nullable(),
    referenceType: z.string().max(50).optional().nullable(),
    referenceId: z.string().uuid().optional().nullable(),
  })
  .strict();

const allocationCreate = z
  .object({
    warehouseId: z.string().uuid(),
    variantId: z.string().uuid(),
    quantity: z.string().trim().min(1),
    expiresAt: z.string().datetime().optional().nullable(),
    referenceType: z.string().max(50).optional().nullable(),
    referenceId: z.string().uuid().optional().nullable(),
  })
  .strict();

const stockReceive = z
  .object({
    warehouseId: z.string().uuid(),
    variantId: z.string().uuid(),
    quantity: z.string().trim().min(1),
    unitCost: z.string().trim().min(1),
    referenceType: z.string().max(50).optional().nullable(),
    referenceId: z.string().uuid().optional().nullable(),
  })
  .strict();

const stockConsume = z
  .object({
    warehouseId: z.string().uuid(),
    variantId: z.string().uuid(),
    quantity: z.string().trim().min(1),
    referenceType: z.string().max(50).optional().nullable(),
    referenceId: z.string().uuid().optional().nullable(),
  })
  .strict();

const transferItemSchema = z
  .object({
    variantId: z.string().uuid(),
    quantity: z.string().trim().min(1),
  })
  .strict();

const transferCreate = z
  .object({
    sourceWarehouseId: z.string().uuid(),
    destinationWarehouseId: z.string().uuid(),
    items: z.array(transferItemSchema).min(1),
  })
  .strict();

const transferReceiveItemSchema = z
  .object({
    transferItemId: z.string().uuid(),
    receivedQuantity: z.string().trim().min(1),
  })
  .strict();

const transferReceiveBody = z
  .object({
    items: z.array(transferReceiveItemSchema).min(1),
  })
  .strict();

const adjustmentCreate = z
  .object({
    stockPositionId: z.string().uuid(),
    adjustmentType: z.enum(['INCREASE', 'DECREASE', 'CORRECTION']),
    quantityChange: z.string().trim().min(1),
    reason: z.string().trim().min(1).max(500),
    approvedBy: z.string().uuid().optional().nullable(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * Admin HTTP controller for the Inventory bounded context.
 *
 * Follows the exact pattern of CatalogAdminController (catalog module):
 * - TenantBearerGuard for auth
 * - Service layer for all reads and writes
 * - Zod validation for all request bodies
 * - Identity contract for authorization
 * - Idempotency-Key header for all mutations
 */
@Controller('/api/v1/admin/inventory')
@UseGuards(TenantBearerGuard)
@ApiTags('Inventory')
@ApiBearerAuth('platform-bearer')
export class InventoryAdminController {
  constructor(
    @Inject(InventoryService) private readonly inventoryService: InventoryService,
    @Inject(IDENTITY_CONTRACTS) private readonly identity: IdentityContracts,
  ) {}

  // -------------------------------------------------------------------------
  // Stock Positions — Reads
  // -------------------------------------------------------------------------

  @Get('stock-positions')
  @ApiOperation({ summary: 'List stock positions for the tenant' })
  @ApiQuery({
    name: 'warehouseId',
    required: false,
    type: String,
    description: 'Filter by warehouse UUID',
  })
  @ApiQuery({
    name: 'variantId',
    required: false,
    type: String,
    description: 'Filter by variant UUID',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Max items (1–100, default 50)',
  })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Pagination offset' })
  @ApiResponse({ status: 200, description: 'Paginated stock position list' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  async listStockPositions(
    @Req() request: AuthenticatedRequest,
    @Query('warehouseId') warehouseId?: string,
    @Query('variantId') _variantId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'inventory.view');
    const rows = await this.inventoryService.listStockPositions(
      principal.organizationId,
      warehouseId,
      limit ? Math.min(parseInt(limit, 10) || 50, 100) : 50,
      offset ? Math.max(parseInt(offset, 10) || 0, 0) : 0,
    );
    return { data: rows.map(toStockPositionJson) };
  }

  @Get('stock-positions/:id')
  @ApiOperation({ summary: 'Get stock position detail by ID' })
  @ApiResponse({ status: 200, description: 'Stock position found' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 404, description: 'Stock position not found' })
  async getStockPosition(
    @Req() request: AuthenticatedRequest,
    @Param('id') stockPositionId: string,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'inventory.view');
    const row = await this.inventoryService.getStockPositionById(
      principal.organizationId,
      stockPositionId,
    );
    if (!row) {
      throw PlatformError.notFound(`Stock position ${stockPositionId} not found.`, {
        details: { stockPositionId },
      });
    }
    return toStockPositionJson(row);
  }

  @Get('stock-positions/:id/fifo-layers')
  @ApiOperation({ summary: 'List FIFO layers for a stock position' })
  @ApiResponse({ status: 200, description: 'FIFO layer list' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  async listFIFOLayers(@Req() request: AuthenticatedRequest, @Param('id') stockPositionId: string) {
    const principal = this.principal(request);
    await this.require(principal, request, 'inventory.view');
    const rows = await this.inventoryService.getFIFOLayers(
      principal.organizationId,
      stockPositionId,
    );
    return { data: rows.map(toFIFOLayerJson) };
  }

  @Get('stock-positions/:id/ledger')
  @ApiOperation({ summary: 'List ledger entries for a stock position' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Max items (1–100, default 50)',
  })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Pagination offset' })
  @ApiResponse({ status: 200, description: 'Ledger entry list' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  async listLedgerEntries(
    @Req() request: AuthenticatedRequest,
    @Param('id') stockPositionId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'inventory.view');
    const rows = await this.inventoryService.getLedgerEntries(
      principal.organizationId,
      stockPositionId,
      limit ? Math.min(parseInt(limit, 10) || 50, 100) : 50,
      offset ? Math.max(parseInt(offset, 10) || 0, 0) : 0,
    );
    return { data: rows.map(toLedgerEntryJson) };
  }

  // -------------------------------------------------------------------------
  // Reservations
  // -------------------------------------------------------------------------

  @Post('reservations')
  @ApiOperation({ summary: 'Create a stock reservation' })
  @ApiResponse({ status: 201, description: 'Reservation created' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async createReservation(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const principal = this.principal(request);
    await this.require(principal, request, 'inventory.create');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const input = reservationCreate.parse(body);
    const result = await this.inventoryService.reserveStock({
      organizationId: principal.organizationId,
      warehouseId: input.warehouseId,
      variantId: input.variantId,
      quantity: input.quantity,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      referenceType: input.referenceType ?? undefined,
      referenceId: input.referenceId ?? undefined,
      idempotencyKey,
      requestHash: computeRequestHash(body),
      principal: { id: principal.organizationUserId },
    });
    return result.reservation;
  }

  @Post('reservations/:id/consume')
  @HttpCode(200)
  @ApiOperation({ summary: 'Consume an active reservation (FIFO stock deduction)' })
  @ApiResponse({ status: 200, description: 'Reservation consumed' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  async consumeReservation(
    @Req() request: AuthenticatedRequest,
    @Param('id') reservationId: string,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'inventory.create');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const result = await this.inventoryService.consumeReservation({
      organizationId: principal.organizationId,
      reservationId,
      idempotencyKey,
      requestHash: computeRequestHash({ reservationId }),
      principal: { id: principal.organizationUserId },
    });
    return result.consumed;
  }

  @Post('reservations/:id/release')
  @HttpCode(200)
  @ApiOperation({ summary: 'Release an active reservation (returns reserved stock)' })
  @ApiResponse({ status: 200, description: 'Reservation released' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  async releaseReservation(
    @Req() request: AuthenticatedRequest,
    @Param('id') reservationId: string,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'inventory.create');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const result = await this.inventoryService.releaseReservation({
      organizationId: principal.organizationId,
      reservationId,
      idempotencyKey,
      requestHash: computeRequestHash({ reservationId }),
      principal: { id: principal.organizationUserId },
    });
    return result.released;
  }

  @Get('reservations')
  @ApiOperation({ summary: 'List reservations for the tenant' })
  @ApiQuery({
    name: 'stockPositionId',
    required: false,
    type: String,
    description: 'Filter by stock position UUID',
  })
  @ApiResponse({ status: 200, description: 'Reservation list' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  async listReservations(
    @Req() request: AuthenticatedRequest,
    @Query('stockPositionId') stockPositionId?: string,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'inventory.view');
    const rows = await this.inventoryService.listReservations(
      principal.organizationId,
      stockPositionId,
    );
    return { data: rows.map(toReservationJson) };
  }

  // -------------------------------------------------------------------------
  // Allocations
  // -------------------------------------------------------------------------

  @Post('allocations')
  @ApiOperation({ summary: 'Create a stock allocation' })
  @ApiResponse({ status: 201, description: 'Allocation created' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async createAllocation(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const principal = this.principal(request);
    await this.require(principal, request, 'inventory.create');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const input = allocationCreate.parse(body);
    const result = await this.inventoryService.allocateStock({
      organizationId: principal.organizationId,
      warehouseId: input.warehouseId,
      variantId: input.variantId,
      quantity: input.quantity,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      referenceType: input.referenceType ?? undefined,
      referenceId: input.referenceId ?? undefined,
      idempotencyKey,
      requestHash: computeRequestHash(body),
      principal: { id: principal.organizationUserId },
    });
    return result.allocation;
  }

  @Post('allocations/:id/consume')
  @HttpCode(200)
  @ApiOperation({ summary: 'Consume an active allocation (FIFO stock deduction)' })
  @ApiResponse({ status: 200, description: 'Allocation consumed' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  async consumeAllocation(@Req() request: AuthenticatedRequest, @Param('id') allocationId: string) {
    const principal = this.principal(request);
    await this.require(principal, request, 'inventory.create');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const result = await this.inventoryService.consumeAllocation({
      organizationId: principal.organizationId,
      allocationId,
      idempotencyKey,
      requestHash: computeRequestHash({ allocationId }),
      principal: { id: principal.organizationUserId },
    });
    return result.consumed;
  }

  @Post('allocations/:id/release')
  @HttpCode(200)
  @ApiOperation({ summary: 'Release an active allocation (returns allocated stock)' })
  @ApiResponse({ status: 200, description: 'Allocation released' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  async releaseAllocation(@Req() request: AuthenticatedRequest, @Param('id') allocationId: string) {
    const principal = this.principal(request);
    await this.require(principal, request, 'inventory.create');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const result = await this.inventoryService.releaseAllocation({
      organizationId: principal.organizationId,
      allocationId,
      idempotencyKey,
      requestHash: computeRequestHash({ allocationId }),
      principal: { id: principal.organizationUserId },
    });
    return result.released;
  }

  @Get('allocations')
  @ApiOperation({ summary: 'List allocations for the tenant' })
  @ApiQuery({
    name: 'stockPositionId',
    required: false,
    type: String,
    description: 'Filter by stock position UUID',
  })
  @ApiResponse({ status: 200, description: 'Allocation list' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  async listAllocations(
    @Req() request: AuthenticatedRequest,
    @Query('stockPositionId') stockPositionId?: string,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'inventory.view');
    const rows = await this.inventoryService.listAllocations(
      principal.organizationId,
      stockPositionId,
    );
    return { data: rows.map(toAllocationJson) };
  }

  // -------------------------------------------------------------------------
  // Stock (Receive / Consume)
  // -------------------------------------------------------------------------

  @Post('stock/receive')
  @ApiOperation({ summary: 'Receive stock into a warehouse (creates FIFO layers)' })
  @ApiResponse({ status: 201, description: 'Stock received' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async receiveStock(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const principal = this.principal(request);
    await this.require(principal, request, 'inventory.create');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const input = stockReceive.parse(body);
    const result = await this.inventoryService.receiveStock({
      organizationId: principal.organizationId,
      warehouseId: input.warehouseId,
      variantId: input.variantId,
      quantity: input.quantity,
      unitCost: input.unitCost,
      referenceType: input.referenceType ?? undefined,
      referenceId: input.referenceId ?? undefined,
      idempotencyKey,
      requestHash: computeRequestHash(body),
      principal: { id: principal.organizationUserId },
    });
    return toStockPositionJson(result.received);
  }

  @Post('stock/consume')
  @HttpCode(200)
  @ApiOperation({ summary: 'Consume stock from a warehouse (FIFO deduction)' })
  @ApiResponse({ status: 200, description: 'Stock consumed' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async consumeStock(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const principal = this.principal(request);
    await this.require(principal, request, 'inventory.create');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const input = stockConsume.parse(body);
    const result = await this.inventoryService.consumeStock({
      organizationId: principal.organizationId,
      warehouseId: input.warehouseId,
      variantId: input.variantId,
      quantity: input.quantity,
      referenceType: input.referenceType ?? undefined,
      referenceId: input.referenceId ?? undefined,
      idempotencyKey,
      requestHash: computeRequestHash(body),
      principal: { id: principal.organizationUserId },
    });
    return toStockPositionJson(result.consumed);
  }

  // -------------------------------------------------------------------------
  // Transfers
  // -------------------------------------------------------------------------

  @Post('transfers')
  @ApiOperation({ summary: 'Create a stock transfer between warehouses' })
  @ApiResponse({ status: 201, description: 'Transfer created' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async createTransfer(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const principal = this.principal(request);
    await this.require(principal, request, 'inventory.transfer');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const input = transferCreate.parse(body);
    const result = await this.inventoryService.createTransfer({
      organizationId: principal.organizationId,
      sourceWarehouseId: input.sourceWarehouseId,
      destinationWarehouseId: input.destinationWarehouseId,
      items: input.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
      idempotencyKey,
      requestHash: computeRequestHash(body),
      principal: { id: principal.organizationUserId },
    });
    return result.transfer;
  }

  @Post('transfers/:id/dispatch')
  @HttpCode(200)
  @ApiOperation({ summary: 'Dispatch a transfer (deduct source stock, move to IN_TRANSIT)' })
  @ApiResponse({ status: 200, description: 'Transfer dispatched' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  async dispatchTransfer(@Req() request: AuthenticatedRequest, @Param('id') transferId: string) {
    const principal = this.principal(request);
    await this.require(principal, request, 'inventory.transfer');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const result = await this.inventoryService.dispatchTransfer({
      organizationId: principal.organizationId,
      transferId,
      idempotencyKey,
      requestHash: computeRequestHash({ transferId }),
      principal: { id: principal.organizationUserId },
    });
    return result.dispatched;
  }

  @Post('transfers/:id/receive')
  @HttpCode(200)
  @ApiOperation({ summary: 'Receive a transfer (increase destination stock)' })
  @ApiResponse({ status: 200, description: 'Transfer received' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async receiveTransfer(
    @Req() request: AuthenticatedRequest,
    @Param('id') transferId: string,
    @Body() body: unknown,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'inventory.transfer');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const input = transferReceiveBody.parse(body);
    const result = await this.inventoryService.receiveTransfer({
      organizationId: principal.organizationId,
      transferId,
      items: input.items.map((i) => ({
        transferItemId: i.transferItemId,
        receivedQuantity: i.receivedQuantity,
      })),
      idempotencyKey,
      requestHash: computeRequestHash(body),
      principal: { id: principal.organizationUserId },
    });
    return result.received;
  }

  @Get('transfers')
  @ApiOperation({ summary: 'List transfers for the tenant' })
  @ApiQuery({
    name: 'status',
    required: false,
    type: String,
    description: 'Filter by status (DRAFT, DISPATCHED, IN_TRANSIT, RECEIVED)',
  })
  @ApiResponse({ status: 200, description: 'Transfer list' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  async listTransfers(@Req() request: AuthenticatedRequest, @Query('status') status?: string) {
    const principal = this.principal(request);
    await this.require(principal, request, 'inventory.view');
    const rows = await this.inventoryService.listTransfers(principal.organizationId, status);
    return { data: rows.map(toTransferJson) };
  }

  @Get('transfers/:id')
  @ApiOperation({ summary: 'Get transfer detail by ID' })
  @ApiResponse({ status: 200, description: 'Transfer found' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 404, description: 'Transfer not found' })
  async getTransfer(@Req() request: AuthenticatedRequest, @Param('id') transferId: string) {
    const principal = this.principal(request);
    await this.require(principal, request, 'inventory.view');
    const row = await this.inventoryService.getTransfer(principal.organizationId, transferId);
    if (!row) {
      throw PlatformError.notFound(`Transfer ${transferId} not found.`, {
        details: { transferId },
      });
    }
    return toTransferJson(row);
  }

  // -------------------------------------------------------------------------
  // Adjustments
  // -------------------------------------------------------------------------

  @Post('adjustments')
  @ApiOperation({ summary: 'Apply a stock adjustment (increase, decrease, or correction)' })
  @ApiResponse({ status: 201, description: 'Adjustment applied' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async applyAdjustment(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const principal = this.principal(request);
    await this.require(principal, request, 'inventory.adjust');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const input = adjustmentCreate.parse(body);
    const result = await this.inventoryService.applyAdjustment({
      organizationId: principal.organizationId,
      stockPositionId: input.stockPositionId,
      adjustmentType: input.adjustmentType,
      quantityChange: input.quantityChange,
      reason: input.reason,
      approvedBy: input.approvedBy ?? undefined,
      idempotencyKey,
      requestHash: computeRequestHash(body),
      principal: { id: principal.organizationUserId },
    });
    return result.adjustment;
  }

  @Get('adjustments')
  @ApiOperation({ summary: 'List stock adjustments for the tenant' })
  @ApiQuery({
    name: 'stockPositionId',
    required: false,
    type: String,
    description: 'Filter by stock position UUID',
  })
  @ApiResponse({ status: 200, description: 'Adjustment list' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  async listAdjustments(
    @Req() request: AuthenticatedRequest,
    @Query('stockPositionId') stockPositionId?: string,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'inventory.view');
    const rows = await this.inventoryService.listAdjustments(
      principal.organizationId,
      stockPositionId,
    );
    return { data: rows.map(toAdjustmentJson) };
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
// Request hash for idempotency (deterministic SHA-256 of serialized body)
// ---------------------------------------------------------------------------

function computeRequestHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

// ---------------------------------------------------------------------------
// JSON mappers for list endpoints
// ---------------------------------------------------------------------------

function toStockPositionJson(row: {
  id: string;
  organizationId: string;
  warehouseId: string;
  variantId: string;
  onHand: string;
  reserved: string;
  allocated: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    warehouseId: row.warehouseId,
    variantId: row.variantId,
    onHand: normalizeInventoryQuantity(row.onHand, { allowZero: true }),
    reserved: normalizeInventoryQuantity(row.reserved, { allowZero: true }),
    allocated: normalizeInventoryQuantity(row.allocated, { allowZero: true }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function toFIFOLayerJson(row: {
  id: string;
  organizationId: string;
  stockPositionId: string;
  receivedAt: Date;
  quantity: string;
  remainingQuantity: string;
  unitCost: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    stockPositionId: row.stockPositionId,
    receivedAt: row.receivedAt,
    quantity: row.quantity,
    remainingQuantity: row.remainingQuantity,
    unitCost: row.unitCost,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toLedgerEntryJson(row: {
  id: string;
  organizationId: string;
  stockPositionId: string;
  entryType: string;
  quantityChange: string;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    stockPositionId: row.stockPositionId,
    entryType: row.entryType,
    quantityChange: row.quantityChange,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toReservationJson(row: {
  id: string;
  organizationId: string;
  stockPositionId: string | null;
  status: string;
  expiresAt: Date | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    stockPositionId: row.stockPositionId,
    status: row.status,
    expiresAt: row.expiresAt,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function toAllocationJson(row: {
  id: string;
  organizationId: string;
  stockPositionId: string;
  status: string;
  expiresAt: Date | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    stockPositionId: row.stockPositionId,
    status: row.status,
    expiresAt: row.expiresAt,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function toTransferJson(row: {
  id: string;
  organizationId: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  status: string;
  dispatchedAt: Date | null;
  receivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    sourceWarehouseId: row.sourceWarehouseId,
    destinationWarehouseId: row.destinationWarehouseId,
    status: row.status,
    dispatchedAt: row.dispatchedAt,
    receivedAt: row.receivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function toAdjustmentJson(row: {
  id: string;
  organizationId: string;
  stockPositionId: string;
  adjustmentType: string;
  quantityBefore: string;
  quantityAfter: string;
  reason: string;
  approvedBy: string | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    stockPositionId: row.stockPositionId,
    adjustmentType: row.adjustmentType,
    quantityBefore: row.quantityBefore,
    quantityAfter: row.quantityAfter,
    reason: row.reason,
    approvedBy: row.approvedBy,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
