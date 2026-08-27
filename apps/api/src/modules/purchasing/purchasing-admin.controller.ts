import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { z } from 'zod';
import { PlatformError } from '@commerce-platform/contracts';
import {
  TenantBearerGuard,
  type AuthenticatedRequest,
} from '../../common/auth/http-auth.guards';
import type { OrganizationUserPrincipal } from '../../common/auth/authenticated-principal';
import { correlationIdFor } from '../../common/http/correlation';
import { IDENTITY_CONTRACTS, type IdentityContracts } from '../identity/contracts';
import { PurchasingService } from './application/purchasing.service';
import type {
  SupplierRow,
  PurchaseOrderRow,
  PurchaseOrderItemRow,
  GoodsReceiptRow,
  GoodsReceiptItemRow,
  PurchaseCostRow,
} from './infrastructure/purchasing.repository';

// ---------------------------------------------------------------------------
// Zod validation schemas
// ---------------------------------------------------------------------------

// --- Supplier ---

const supplierCreate = z
  .object({
    name: z.string().trim().min(1).max(200),
    code: z.string().trim().min(1).max(50),
    contactName: z.string().trim().max(200).optional().nullable(),
    email: z.string().email().optional().nullable(),
    phone: z.string().trim().max(50).optional().nullable(),
    address: z.string().trim().max(500).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .strict();

const supplierUpdate = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    contactName: z.string().trim().max(200).optional().nullable(),
    email: z.string().email().optional().nullable(),
    phone: z.string().trim().max(50).optional().nullable(),
    address: z.string().trim().max(500).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .strict();

// --- Purchase Order ---

const poItemInput = z
  .object({
    variantId: z.string().uuid(),
    quantity: z.string().trim().min(1),
    unitCost: z.string().trim().min(1),
    packagingUnit: z.string().trim().max(50).optional().nullable(),
    packagingQuantity: z.string().trim().optional().nullable(),
    packagingConversion: z.string().trim().optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .strict();

const poCreate = z
  .object({
    supplierId: z.string().uuid(),
    warehouseId: z.string().uuid(),
    expectedDeliveryDate: z.string().datetime().optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
    items: z.array(poItemInput).min(1),
  })
  .strict();

const poUpdate = z
  .object({
    expectedDeliveryDate: z.string().datetime().optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .strict();

const poReject = z
  .object({
    reason: z.string().trim().max(500).optional().nullable(),
  })
  .strict();

const poCancel = z
  .object({
    reason: z.string().trim().max(500).optional().nullable(),
  })
  .strict();

// --- Goods Receipt ---

const grItemInput = z
  .object({
    purchaseOrderItemId: z.string().uuid(),
    variantId: z.string().uuid(),
    quantityReceived: z.string().trim().min(1),
    quantityAccepted: z.string().trim().min(1),
    quantityRejected: z.string().trim().optional().default('0'),
    unitCost: z.string().trim().min(1),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .strict();

const grCostInput = z
  .object({
    costType: z.enum(['SHIPPING', 'CUSTOMS', 'HANDLING', 'OTHER']),
    amount: z.string().trim().min(1),
    description: z.string().trim().max(500).optional().nullable(),
  })
  .strict();

const grCreate = z
  .object({
    purchaseOrderId: z.string().uuid(),
    warehouseId: z.string().uuid(),
    receivedDate: z.string().datetime().optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
    items: z.array(grItemInput).min(1),
    costs: z.array(grCostInput).optional(),
  })
  .strict();

const grCancel = z
  .object({
    reason: z.string().trim().max(500).optional().nullable(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * Admin HTTP controller for the Purchasing bounded context.
 *
 * Follows the exact pattern of InventoryAdminController:
 * - TenantBearerGuard for auth
 * - Service layer for all reads and writes
 * - Zod validation for all request bodies
 * - Identity contract for authorization
 * - Idempotency-Key header for all mutations
 */
@Controller('/api/v1/admin/purchasing')
@UseGuards(TenantBearerGuard)
@ApiTags('Purchasing')
@ApiBearerAuth('platform-bearer')
export class PurchasingAdminController {
  constructor(
    @Inject(PurchasingService)
    private readonly purchasingService: PurchasingService,
    @Inject(IDENTITY_CONTRACTS)
    private readonly identity: IdentityContracts,
  ) {}

  // -------------------------------------------------------------------------
  // Suppliers — Reads
  // -------------------------------------------------------------------------

  @Get('suppliers')
  @ApiOperation({ summary: 'List suppliers for the tenant' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Max items (1–100, default 50)',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Pagination offset',
  })
  @ApiResponse({ status: 200, description: 'Paginated supplier list' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  async listSuppliers(
    @Req() request: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'purchasing.read');
    const rows = await this.purchasingService.listSuppliers(
      principal.organizationId,
      limit ? Math.min(parseInt(limit, 10) || 50, 100) : 50,
      offset ? Math.max(parseInt(offset, 10) || 0, 0) : 0,
    );
    return { data: rows.map(toJsonSupplier) };
  }

  // -------------------------------------------------------------------------
  // Suppliers — Mutations
  // -------------------------------------------------------------------------

  @Post('suppliers')
  @ApiOperation({ summary: 'Create a new supplier' })
  @ApiResponse({ status: 201, description: 'Supplier created' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async createSupplier(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'purchasing.write');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const input = supplierCreate.parse(body);
    const row = await this.purchasingService.createSupplier(
      principal.organizationId,
      {
        name: input.name,
        code: input.code,
        contactName: input.contactName ?? undefined,
        email: input.email ?? undefined,
        phone: input.phone ?? undefined,
        address: input.address ?? undefined,
        notes: input.notes ?? undefined,
      },
      idempotencyKey,
      { id: principal.organizationUserId },
    );
    return toJsonSupplier(row);
  }

  @Patch('suppliers/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update an existing supplier' })
  @ApiResponse({ status: 200, description: 'Supplier updated' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 404, description: 'Supplier not found' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async updateSupplier(
    @Req() request: AuthenticatedRequest,
    @Param('id') supplierId: string,
    @Body() body: unknown,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'purchasing.write');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const input = supplierUpdate.parse(body);
    const row = await this.purchasingService.updateSupplier(
      principal.organizationId,
      supplierId,
      {
        name: input.name,
        contactName: input.contactName,
        email: input.email,
        phone: input.phone,
        address: input.address,
        notes: input.notes,
      },
      idempotencyKey,
      { id: principal.organizationUserId },
    );
    return toJsonSupplier(row);
  }

  // -------------------------------------------------------------------------
  // Purchase Orders — Reads
  // -------------------------------------------------------------------------

  @Get('purchase-orders')
  @ApiOperation({ summary: 'List purchase orders for the tenant' })
  @ApiQuery({
    name: 'status',
    required: false,
    type: String,
    description:
      'Filter by status (DRAFT, SUBMITTED, APPROVED, REJECTED, SENT, PARTIALLY_RECEIVED, RECEIVED, CANCELLED)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Max items (1–100, default 50)',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Pagination offset',
  })
  @ApiResponse({ status: 200, description: 'Paginated purchase order list' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  async listPurchaseOrders(
    @Req() request: AuthenticatedRequest,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'purchasing.read');
    const rows = await this.purchasingService.listPOs(
      principal.organizationId,
      status,
      limit ? Math.min(parseInt(limit, 10) || 50, 100) : 50,
      offset ? Math.max(parseInt(offset, 10) || 0, 0) : 0,
    );
    return { data: rows.map(toJsonPO) };
  }

  @Get('purchase-orders/:id')
  @ApiOperation({ summary: 'Get purchase order detail by ID (with items)' })
  @ApiResponse({ status: 200, description: 'Purchase order found' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 404, description: 'Purchase order not found' })
  async getPurchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Param('id') poId: string,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'purchasing.read');
    const po = await this.purchasingService.getPOById(
      principal.organizationId,
      poId,
    );
    if (!po) {
      throw PlatformError.notFound(`Purchase order ${poId} not found.`, {
        details: { poId },
      });
    }
    const items = await this.purchasingService.getPOItems(
      principal.organizationId,
      poId,
    );
    return toJsonPOWithItems(po, items);
  }

  // -------------------------------------------------------------------------
  // Purchase Orders — Mutations
  // -------------------------------------------------------------------------

  @Post('purchase-orders')
  @ApiOperation({ summary: 'Create a new purchase order with line items' })
  @ApiResponse({ status: 201, description: 'Purchase order created' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async createPurchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'purchasing.write');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const input = poCreate.parse(body);
    const row = await this.purchasingService.createPO(
      principal.organizationId,
      {
        supplierId: input.supplierId,
        warehouseId: input.warehouseId,
        expectedDeliveryDate: input.expectedDeliveryDate
          ? new Date(input.expectedDeliveryDate)
          : undefined,
        notes: input.notes ?? undefined,
        items: input.items.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          packagingUnit: item.packagingUnit ?? undefined,
          packagingQuantity: item.packagingQuantity ?? undefined,
          packagingConversion: item.packagingConversion ?? undefined,
          notes: item.notes ?? undefined,
        })),
      },
      idempotencyKey,
      { id: principal.organizationUserId },
    );
    return toJsonPO(row);
  }

  @Patch('purchase-orders/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update a draft purchase order' })
  @ApiResponse({ status: 200, description: 'Purchase order updated' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 404, description: 'Purchase order not found' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async updatePurchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Param('id') poId: string,
    @Body() body: unknown,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'purchasing.write');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const input = poUpdate.parse(body);
    const row = await this.purchasingService.updatePO(
      principal.organizationId,
      poId,
      {
        expectedDeliveryDate: input.expectedDeliveryDate
          ? new Date(input.expectedDeliveryDate)
          : input.expectedDeliveryDate === null
            ? null
            : undefined,
        notes: input.notes,
      },
      idempotencyKey,
      { id: principal.organizationUserId },
    );
    return toJsonPO(row);
  }

  @Post('purchase-orders/:id/submit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit a purchase order for approval' })
  @ApiResponse({ status: 200, description: 'Purchase order submitted' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 404, description: 'Purchase order not found' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  async submitPurchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Param('id') poId: string,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'purchasing.write');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const row = await this.purchasingService.submitPO(
      principal.organizationId,
      poId,
      idempotencyKey,
      { id: principal.organizationUserId },
    );
    return toJsonPO(row);
  }

  @Post('purchase-orders/:id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve a submitted purchase order' })
  @ApiResponse({ status: 200, description: 'Purchase order approved' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 404, description: 'Purchase order not found' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  async approvePurchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Param('id') poId: string,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'purchasing.approve');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const row = await this.purchasingService.approvePO(
      principal.organizationId,
      poId,
      idempotencyKey,
      { id: principal.organizationUserId },
    );
    return toJsonPO(row);
  }

  @Post('purchase-orders/:id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject a submitted purchase order' })
  @ApiResponse({ status: 200, description: 'Purchase order rejected' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 404, description: 'Purchase order not found' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async rejectPurchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Param('id') poId: string,
    @Body() body: unknown,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'purchasing.approve');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const input = poReject.parse(body);
    const row = await this.purchasingService.rejectPO(
      principal.organizationId,
      poId,
      input.reason ?? null,
      idempotencyKey,
      { id: principal.organizationUserId },
    );
    return toJsonPO(row);
  }

  @Post('purchase-orders/:id/send')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send an approved purchase order to the supplier' })
  @ApiResponse({ status: 200, description: 'Purchase order sent' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 404, description: 'Purchase order not found' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  async sendPurchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Param('id') poId: string,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'purchasing.write');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const row = await this.purchasingService.sendPO(
      principal.organizationId,
      poId,
      idempotencyKey,
      { id: principal.organizationUserId },
    );
    return toJsonPO(row);
  }

  @Post('purchase-orders/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a purchase order' })
  @ApiResponse({ status: 200, description: 'Purchase order cancelled' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 404, description: 'Purchase order not found' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async cancelPurchaseOrder(
    @Req() request: AuthenticatedRequest,
    @Param('id') poId: string,
    @Body() body: unknown,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'purchasing.write');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const input = poCancel.parse(body);
    const row = await this.purchasingService.cancelPO(
      principal.organizationId,
      poId,
      input.reason ?? null,
      idempotencyKey,
      { id: principal.organizationUserId },
    );
    return toJsonPO(row);
  }

  // -------------------------------------------------------------------------
  // Goods Receipts — Reads
  // -------------------------------------------------------------------------

  @Get('goods-receipts')
  @ApiOperation({ summary: 'List goods receipts for the tenant' })
  @ApiQuery({
    name: 'purchaseOrderId',
    required: false,
    type: String,
    description: 'Filter by purchase order UUID',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Max items (1–100, default 50)',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Pagination offset',
  })
  @ApiResponse({ status: 200, description: 'Paginated goods receipt list' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  async listGoodsReceipts(
    @Req() request: AuthenticatedRequest,
    @Query('purchaseOrderId') purchaseOrderId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'purchasing.read');
    const rows = await this.purchasingService.listGRs(
      principal.organizationId,
      purchaseOrderId,
      limit ? Math.min(parseInt(limit, 10) || 50, 100) : 50,
      offset ? Math.max(parseInt(offset, 10) || 0, 0) : 0,
    );
    return { data: rows.map(toJsonGR) };
  }

  @Get('goods-receipts/:id')
  @ApiOperation({ summary: 'Get goods receipt detail by ID (with items and costs)' })
  @ApiResponse({ status: 200, description: 'Goods receipt found' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 404, description: 'Goods receipt not found' })
  async getGoodsReceipt(
    @Req() request: AuthenticatedRequest,
    @Param('id') grId: string,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'purchasing.read');
    const gr = await this.purchasingService.getGRById(
      principal.organizationId,
      grId,
    );
    if (!gr) {
      throw PlatformError.notFound(`Goods receipt ${grId} not found.`, {
        details: { grId },
      });
    }
    const items = await this.purchasingService.getGRItems(
      principal.organizationId,
      grId,
    );
    const costs = await this.purchasingService.getGRCosts(
      principal.organizationId,
      grId,
    );
    return toJsonGRWithDetails(gr, items, costs);
  }

  // -------------------------------------------------------------------------
  // Goods Receipts — Mutations
  // -------------------------------------------------------------------------

  @Post('goods-receipts')
  @ApiOperation({ summary: 'Create a new goods receipt against a purchase order' })
  @ApiResponse({ status: 201, description: 'Goods receipt created' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async createGoodsReceipt(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'purchasing.receive');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const input = grCreate.parse(body);
    const row = await this.purchasingService.createGR(
      principal.organizationId,
      {
        purchaseOrderId: input.purchaseOrderId,
        warehouseId: input.warehouseId,
        receivedDate: input.receivedDate
          ? new Date(input.receivedDate)
          : undefined,
        notes: input.notes ?? undefined,
        items: input.items.map((item) => ({
          purchaseOrderItemId: item.purchaseOrderItemId,
          variantId: item.variantId,
          quantityReceived: item.quantityReceived,
          quantityAccepted: item.quantityAccepted,
          quantityRejected: item.quantityRejected,
          unitCost: item.unitCost,
          notes: item.notes ?? undefined,
        })),
        costs: input.costs?.map((cost) => ({
          costType: cost.costType,
          amount: cost.amount,
          description: cost.description ?? undefined,
        })),
      },
      idempotencyKey,
      { id: principal.organizationUserId },
    );
    return toJsonGR(row);
  }

  @Post('goods-receipts/:id/confirm')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Confirm a goods receipt (PENDING → CONFIRMED, triggers inventory receipt)',
  })
  @ApiResponse({ status: 200, description: 'Goods receipt confirmed' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 404, description: 'Goods receipt not found' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  async confirmGoodsReceipt(
    @Req() request: AuthenticatedRequest,
    @Param('id') grId: string,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'purchasing.receive');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const row = await this.purchasingService.confirmGR(
      principal.organizationId,
      grId,
      idempotencyKey,
      { id: principal.organizationUserId },
    );
    return toJsonGR(row);
  }

  @Post('goods-receipts/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a pending goods receipt' })
  @ApiResponse({ status: 200, description: 'Goods receipt cancelled' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  @ApiResponse({ status: 404, description: 'Goods receipt not found' })
  @ApiResponse({ status: 409, description: 'Idempotency key conflict' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async cancelGoodsReceipt(
    @Req() request: AuthenticatedRequest,
    @Param('id') grId: string,
    @Body() body: unknown,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'purchasing.receive');
    const idempotencyKey = this.requireIdempotencyKey(request);
    const input = grCancel.parse(body);
    const row = await this.purchasingService.cancelGR(
      principal.organizationId,
      grId,
      input.reason ?? null,
      idempotencyKey,
      { id: principal.organizationUserId },
    );
    return toJsonGR(row);
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
      throw PlatformError.validationFailed(
        'Idempotency-Key is required for mutation requests.',
        { details: { field: 'Idempotency-Key' } },
      );
    return key;
  }
}

// ---------------------------------------------------------------------------
// JSON mappers
// ---------------------------------------------------------------------------

function toJsonSupplier(row: SupplierRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    code: row.code,
    contactName: row.contactName,
    email: row.email,
    phone: row.phone,
    address: row.address,
    isActive: row.isActive,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function toJsonPO(row: PurchaseOrderRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    supplierId: row.supplierId,
    warehouseId: row.warehouseId,
    status: row.status,
    orderDate: row.orderDate,
    expectedDeliveryDate: row.expectedDeliveryDate,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function toJsonPOItem(item: PurchaseOrderItemRow) {
  return {
    id: item.id,
    organizationId: item.organizationId,
    purchaseOrderId: item.purchaseOrderId,
    variantId: item.variantId,
    quantity: item.quantity,
    receivedQuantity: item.receivedQuantity,
    unitCost: item.unitCost,
    packagingUnit: item.packagingUnit,
    packagingQuantity: item.packagingQuantity,
    packagingConversion: item.packagingConversion,
    notes: item.notes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toJsonPOWithItems(
  row: PurchaseOrderRow,
  items: PurchaseOrderItemRow[],
) {
  return {
    ...toJsonPO(row),
    items: items.map(toJsonPOItem),
  };
}

function toJsonGR(row: GoodsReceiptRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    purchaseOrderId: row.purchaseOrderId,
    warehouseId: row.warehouseId,
    status: row.status,
    receivedDate: row.receivedDate,
    notes: row.notes,
    confirmedAt: row.confirmedAt,
    confirmedBy: row.confirmedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function toJsonGRItem(item: GoodsReceiptItemRow) {
  return {
    id: item.id,
    organizationId: item.organizationId,
    goodsReceiptId: item.goodsReceiptId,
    purchaseOrderItemId: item.purchaseOrderItemId,
    variantId: item.variantId,
    quantityReceived: item.quantityReceived,
    quantityAccepted: item.quantityAccepted,
    quantityRejected: item.quantityRejected,
    unitCost: item.unitCost,
    notes: item.notes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toJsonGRCost(cost: PurchaseCostRow) {
  return {
    id: cost.id,
    organizationId: cost.organizationId,
    goodsReceiptId: cost.goodsReceiptId,
    costType: cost.costType,
    amount: cost.amount,
    currency: cost.currency,
    description: cost.description,
    createdAt: cost.createdAt,
    updatedAt: cost.updatedAt,
  };
}

function toJsonGRWithDetails(
  row: GoodsReceiptRow,
  items: GoodsReceiptItemRow[],
  costs: PurchaseCostRow[],
) {
  return {
    ...toJsonGR(row),
    items: items.map(toJsonGRItem),
    costs: costs.map(toJsonGRCost),
  };
}
