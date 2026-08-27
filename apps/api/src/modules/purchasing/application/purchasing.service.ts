import { type DatabaseClient } from '@commerce-platform/database';
import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { DATABASE } from '../../database/database.tokens';
import { INVENTORY_CONTRACTS, type InventoryContracts } from '../../inventory/contracts';
import {
  PurchasingRepository,
  type SupplierRow,
  type PurchaseOrderRow,
  type PurchaseOrderItemRow,
  type GoodsReceiptRow,
  type GoodsReceiptItemRow,
  type PurchaseCostRow,
} from '../infrastructure/purchasing.repository';
import { purchasingEvent, type PurchasingEventType } from '../infrastructure/event-envelope';
import { calculateLandedCost } from '../domain/invariants';
import { validatePOStatusTransition } from '../domain/invariants';

/**
 * Application service of the Purchasing bounded context: one method per domain
 * command, each executed inside a single database transaction that:
 *
 * 1. Claims an idempotency key
 * 2. Validates business rules
 * 3. Persists state changes
 * 4. Writes Outbox events
 * 5. Records idempotency outcome
 *
 * Authentication, authorization and entitlement checks are intentionally NOT
 * part of this service; they live in the HTTP controller layer.
 *
 * Cross-context calls (e.g. InventoryService.receiveStock) go through the
 * INVENTORY_CONTRACTS injection token — Purchasing NEVER directly mutates
 * Inventory tables.
 */
@Injectable()
export class PurchasingService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(PurchasingRepository)
    private readonly repository: PurchasingRepository,
    @Inject(INVENTORY_CONTRACTS)
    private readonly inventoryContracts: InventoryContracts,
  ) {}

  // ===========================================================================
  // Supplier Commands
  // ===========================================================================

  async createSupplier(
    orgId: string,
    data: {
      name: string;
      code: string;
      contactName?: string | null;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
      notes?: string | null;
    },
    idempotencyKey: string,
    principal: { id: string },
  ): Promise<SupplierRow> {
    const scope = `purchasing:createSupplier:${orgId}`;

    const result = await this.db.transaction(async (tx) => {
      // Idempotency check
      const claim = await this.repository.claimIdempotency(
        tx,
        idempotencyKey,
        scope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED' && claim.responseJson) {
          return claim.responseJson as unknown as SupplierRow;
        }
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey },
        });
      }

      // Validate name/code unique within org
      const existingByName = await this.repository.findSupplierByCode(
        tx,
        orgId,
        data.code,
      );
      if (existingByName) {
        throw PlatformError.of(
          ERROR_CODES.VALIDATION_FAILED,
          `Supplier with code "${data.code}" already exists in this organization.`,
          { details: { code: data.code, organizationId: orgId } },
        );
      }

      // Create supplier via domain aggregate (validates invariants)
      const { Supplier } = await import('../domain/supplier');
      const id = (await import('@commerce-platform/database')).newId();
      const aggregate = Supplier.create({
        id,
        organizationId: orgId,
        name: data.name,
        code: data.code,
        contactName: data.contactName,
        email: data.email,
        phone: data.phone,
        address: data.address,
        notes: data.notes,
      });

      // Persist
      const row = await this.repository.createSupplier(tx, {
        id: aggregate.id,
        organizationId: orgId,
        name: aggregate.name,
        code: aggregate.code,
        contactName: aggregate.contactName,
        email: aggregate.email,
        phone: aggregate.phone,
        address: aggregate.address,
        isActive: aggregate.isActive,
        notes: aggregate.notes,
      });

      aggregate.markPersisted();
      const events = aggregate.pullDomainEvents();

      // Write outbox events
      for (const event of events) {
        if (event.type === 'SupplierCreated') {
          await this.repository.writeOutbox(
            tx,
            purchasingEvent(
              'purchasing.supplier-created',
              orgId,
              'Supplier',
              row.id,
              row.version,
              idempotencyKey,
              idempotencyKey,
              principal.id,
              {
                name: row.name,
                code: row.code,
              },
            ),
          );
        }
      }

      // Record idempotency outcome
      await this.repository.writeOutcome(tx, claim.claimId, 'COMPLETED', row as unknown as Record<string, unknown>);

      return row;
    });

    return result;
  }

  async updateSupplier(
    orgId: string,
    supplierId: string,
    data: { name: string },
    idempotencyKey: string,
    principal: { id: string },
  ): Promise<SupplierRow> {
    const scope = `purchasing:updateSupplier:${orgId}`;

    const result = await this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotency(
        tx,
        idempotencyKey,
        scope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED' && claim.responseJson) {
          return claim.responseJson as unknown as SupplierRow;
        }
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey },
        });
      }

      // Load supplier
      const existing = await this.repository.findSupplierById(
        tx,
        orgId,
        supplierId,
      );
      if (!existing) {
        throw PlatformError.notFound(`Supplier ${supplierId} not found.`, {
          details: { supplierId, organizationId: orgId },
        });
      }

      // Apply update via domain aggregate
      const { Supplier } = await import('../domain/supplier');
      const aggregate = Supplier.reconstitute({
        id: existing.id,
        organizationId: existing.organizationId,
        name: existing.name,
        code: existing.code,
        contactName: existing.contactName,
        email: existing.email,
        phone: existing.phone,
        address: existing.address,
        isActive: existing.isActive,
        notes: existing.notes,
        version: existing.version,
      });

      aggregate.updateName(data.name);

      // Persist with version check
      const updated = await this.repository.updateSupplier(
        tx,
        orgId,
        supplierId,
        { name: aggregate.name },
        existing.version,
      );

      if (!updated) {
        throw PlatformError.of(
          ERROR_CODES.RESOURCE_VERSION_CONFLICT,
          `Supplier ${supplierId} was modified concurrently.`,
          { details: { supplierId, expectedVersion: existing.version } },
        );
      }

      aggregate.markPersisted();
      const events = aggregate.pullDomainEvents();

      for (const event of events) {
        if (event.type === 'SupplierUpdated') {
          await this.repository.writeOutbox(
            tx,
            purchasingEvent(
              'purchasing.supplier-updated',
              orgId,
              'Supplier',
              updated.id,
              updated.version,
              idempotencyKey,
              idempotencyKey,
              principal.id,
              { name: updated.name },
            ),
          );
        }
      }

      await this.repository.writeOutcome(tx, claim.claimId, 'COMPLETED', updated as unknown as Record<string, unknown>);

      return updated;
    });

    return result;
  }

  async deactivateSupplier(
    orgId: string,
    supplierId: string,
    idempotencyKey: string,
    principal: { id: string },
  ): Promise<void> {
    const scope = `purchasing:deactivateSupplier:${orgId}`;

    await this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotency(
        tx,
        idempotencyKey,
        scope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED') return;
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey },
        });
      }

      const existing = await this.repository.findSupplierById(
        tx,
        orgId,
        supplierId,
      );
      if (!existing) {
        throw PlatformError.notFound(`Supplier ${supplierId} not found.`, {
          details: { supplierId, organizationId: orgId },
        });
      }

      const { Supplier } = await import('../domain/supplier');
      const aggregate = Supplier.reconstitute({
        id: existing.id,
        organizationId: existing.organizationId,
        name: existing.name,
        code: existing.code,
        contactName: existing.contactName,
        email: existing.email,
        phone: existing.phone,
        address: existing.address,
        isActive: existing.isActive,
        notes: existing.notes,
        version: existing.version,
      });

      aggregate.deactivate();

      const updated = await this.repository.updateSupplier(
        tx,
        orgId,
        supplierId,
        { isActive: aggregate.isActive },
        existing.version,
      );

      if (!updated) {
        throw PlatformError.of(
          ERROR_CODES.RESOURCE_VERSION_CONFLICT,
          `Supplier ${supplierId} was modified concurrently.`,
          { details: { supplierId, expectedVersion: existing.version } },
        );
      }

      aggregate.markPersisted();
      const events = aggregate.pullDomainEvents();

      for (const event of events) {
        if (event.type === 'SupplierDeactivated') {
          await this.repository.writeOutbox(
            tx,
            purchasingEvent(
              'purchasing.supplier-deactivated',
              orgId,
              'Supplier',
              updated.id,
              updated.version,
              idempotencyKey,
              idempotencyKey,
              principal.id,
              {},
            ),
          );
        }
      }

      await this.repository.writeOutcome(tx, claim.claimId, 'COMPLETED', null);
    });
  }

  // ===========================================================================
  // Supplier Queries
  // ===========================================================================

  async listSuppliers(
    orgId: string,
    limit?: number,
    offset?: number,
  ): Promise<SupplierRow[]> {
    return this.repository.listSuppliers(this.db, orgId, limit, offset);
  }

  async getSupplierById(
    orgId: string,
    supplierId: string,
  ): Promise<SupplierRow | null> {
    return this.repository.findSupplierById(this.db, orgId, supplierId);
  }

  // ===========================================================================
  // Purchase Order Commands
  // ===========================================================================

  async createPO(
    orgId: string,
    data: {
      supplierId: string;
      warehouseId: string;
      orderDate?: Date;
      expectedDeliveryDate?: Date | null;
      notes?: string | null;
      items: Array<{
        variantId: string;
        quantity: string;
        unitCost: string;
        packagingUnit?: string | null;
        packagingQuantity?: string | null;
        packagingConversion?: string | null;
        notes?: string | null;
      }>;
    },
    idempotencyKey: string,
    principal: { id: string },
  ): Promise<PurchaseOrderRow> {
    const scope = `purchasing:createPO:${orgId}`;

    const result = await this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotency(
        tx,
        idempotencyKey,
        scope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED' && claim.responseJson) {
          return claim.responseJson as unknown as PurchaseOrderRow;
        }
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey },
        });
      }

      // Validate supplier exists and is active
      const supplier = await this.repository.findSupplierById(
        tx,
        orgId,
        data.supplierId,
      );
      if (!supplier) {
        throw PlatformError.notFound(
          `Supplier ${data.supplierId} not found.`,
          { details: { supplierId: data.supplierId, organizationId: orgId } },
        );
      }
      if (!supplier.isActive) {
        throw PlatformError.of(
          ERROR_CODES.OPERATION_NOT_ALLOWED,
          `Supplier ${data.supplierId} is not active.`,
          { details: { supplierId: data.supplierId } },
        );
      }

      // Validate warehouse exists (via FK constraint — we just check the PO can be created)
      // The FK constraint on purchase_orders will catch invalid warehouseId.

      // Validate items array
      if (!data.items || data.items.length === 0) {
        throw PlatformError.of(
          ERROR_CODES.VALIDATION_FAILED,
          'Purchase order must have at least one item.',
          { details: { itemCount: data.items?.length ?? 0 } },
        );
      }

      // Create PO aggregate (validates items, quantities, etc.)
      const { PurchaseOrder } = await import('../domain/purchase-order');
      const { newId } = await import('@commerce-platform/database');
      const poId = newId();

      const aggregate = PurchaseOrder.create({
        id: poId,
        organizationId: orgId,
        supplierId: data.supplierId,
        warehouseId: data.warehouseId,
        orderDate: data.orderDate,
        expectedDeliveryDate: data.expectedDeliveryDate,
        notes: data.notes,
        items: data.items.map((item) => ({
          id: newId(),
          variantId: item.variantId,
          quantity: parseFloat(item.quantity),
          unitCost: parseFloat(item.unitCost),
          packagingUnit: item.packagingUnit,
          packagingQuantity: item.packagingQuantity
            ? parseFloat(item.packagingQuantity)
            : null,
          packagingConversion: item.packagingConversion
            ? parseFloat(item.packagingConversion)
            : null,
          notes: item.notes,
        })),
      });

      // Persist PO
      const poRow = await this.repository.createPO(tx, {
        id: aggregate.id,
        organizationId: orgId,
        supplierId: aggregate.supplierId,
        warehouseId: aggregate.warehouseId,
        status: aggregate.status,
        orderDate: aggregate.orderDate,
        expectedDeliveryDate: aggregate.expectedDeliveryDate,
        notes: aggregate.notes,
      });

      // Persist PO items
      for (const item of aggregate.items) {
        await this.repository.createPOItem(tx, {
          id: item.id,
          organizationId: orgId,
          purchaseOrderId: poRow.id,
          variantId: item.variantId,
          quantity: String(item.quantity),
          unitCost: String(item.unitCost),
          packagingUnit: item.packagingUnit,
          packagingQuantity: item.packagingQuantity
            ? String(item.packagingQuantity)
            : null,
          packagingConversion: item.packagingConversion
            ? String(item.packagingConversion)
            : null,
          notes: item.notes,
        });
      }

      aggregate.markPersisted();
      const events = aggregate.pullDomainEvents();

      // Write outbox events
      for (const event of events) {
        if (event.type === 'PurchaseOrderCreated') {
          await this.repository.writeOutbox(
            tx,
            purchasingEvent(
              'purchasing.purchase-order-created',
              orgId,
              'PurchaseOrder',
              poRow.id,
              poRow.version,
              idempotencyKey,
              idempotencyKey,
              principal.id,
              {
                supplierId: aggregate.supplierId,
                warehouseId: aggregate.warehouseId,
                itemCount: aggregate.items.length,
              },
            ),
          );
        }
      }

      await this.repository.writeOutcome(tx, claim.claimId, 'COMPLETED', poRow as unknown as Record<string, unknown>);

      return poRow;
    });

    return result;
  }

  async submitPO(
    orgId: string,
    poId: string,
    idempotencyKey: string,
    principal: { id: string },
  ): Promise<PurchaseOrderRow> {
    return this.transitionPO(
      orgId,
      poId,
      'SUBMITTED',
      idempotencyKey,
      principal,
      'purchasing.purchase-order-submitted',
    );
  }

  async approvePO(
    orgId: string,
    poId: string,
    idempotencyKey: string,
    principal: { id: string },
  ): Promise<PurchaseOrderRow> {
    return this.transitionPO(
      orgId,
      poId,
      'APPROVED',
      idempotencyKey,
      principal,
      'purchasing.purchase-order-approved',
    );
  }

  async rejectPO(
    orgId: string,
    poId: string,
    reason: string | null,
    idempotencyKey: string,
    principal: { id: string },
  ): Promise<PurchaseOrderRow> {
    const scope = `purchasing:rejectPO:${orgId}`;

    const result = await this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotency(
        tx,
        idempotencyKey,
        scope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED' && claim.responseJson) {
          return claim.responseJson as unknown as PurchaseOrderRow;
        }
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey },
        });
      }

      const existing = await this.repository.findPOById(tx, orgId, poId);
      if (!existing) {
        throw PlatformError.notFound(`Purchase order ${poId} not found.`, {
          details: { poId, organizationId: orgId },
        });
      }

      validatePOStatusTransition(existing.status, 'REJECTED');

      const updated = await this.repository.updatePO(
        tx,
        orgId,
        poId,
        { status: 'REJECTED' },
        existing.version,
      );

      if (!updated) {
        throw PlatformError.of(
          ERROR_CODES.RESOURCE_VERSION_CONFLICT,
          `Purchase order ${poId} was modified concurrently.`,
          { details: { poId, expectedVersion: existing.version } },
        );
      }

      await this.repository.writeOutbox(
        tx,
        purchasingEvent(
          'purchasing.purchase-order-rejected',
          orgId,
          'PurchaseOrder',
          updated.id,
          updated.version,
          idempotencyKey,
          idempotencyKey,
          principal.id,
          { reason: reason ?? null },
        ),
      );

      await this.repository.writeOutcome(tx, claim.claimId, 'COMPLETED', updated as unknown as Record<string, unknown>);

      return updated;
    });

    return result;
  }

  async sendPO(
    orgId: string,
    poId: string,
    idempotencyKey: string,
    principal: { id: string },
  ): Promise<PurchaseOrderRow> {
    return this.transitionPO(
      orgId,
      poId,
      'SENT',
      idempotencyKey,
      principal,
      'purchasing.purchase-order-sent',
    );
  }

  async cancelPO(
    orgId: string,
    poId: string,
    reason: string | null,
    idempotencyKey: string,
    principal: { id: string },
  ): Promise<PurchaseOrderRow> {
    const scope = `purchasing:cancelPO:${orgId}`;

    const result = await this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotency(
        tx,
        idempotencyKey,
        scope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED' && claim.responseJson) {
          return claim.responseJson as unknown as PurchaseOrderRow;
        }
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey },
        });
      }

      const existing = await this.repository.findPOById(tx, orgId, poId);
      if (!existing) {
        throw PlatformError.notFound(`Purchase order ${poId} not found.`, {
          details: { poId, organizationId: orgId },
        });
      }

      validatePOStatusTransition(existing.status, 'CANCELLED');

      const updated = await this.repository.updatePO(
        tx,
        orgId,
        poId,
        { status: 'CANCELLED' },
        existing.version,
      );

      if (!updated) {
        throw PlatformError.of(
          ERROR_CODES.RESOURCE_VERSION_CONFLICT,
          `Purchase order ${poId} was modified concurrently.`,
          { details: { poId, expectedVersion: existing.version } },
        );
      }

      await this.repository.writeOutbox(
        tx,
        purchasingEvent(
          'purchasing.purchase-order-cancelled',
          orgId,
          'PurchaseOrder',
          updated.id,
          updated.version,
          idempotencyKey,
          idempotencyKey,
          principal.id,
          { reason: reason ?? null },
        ),
      );

      await this.repository.writeOutcome(tx, claim.claimId, 'COMPLETED', updated as unknown as Record<string, unknown>);

      return updated;
    });

    return result;
  }

  // ===========================================================================
  // Purchase Order Queries
  // ===========================================================================

  async listPOs(
    orgId: string,
    status?: string,
    limit?: number,
    offset?: number,
  ): Promise<PurchaseOrderRow[]> {
    return this.repository.listPOs(this.db, orgId, status, limit, offset);
  }

  async getPOById(
    orgId: string,
    poId: string,
  ): Promise<PurchaseOrderRow | null> {
    return this.repository.findPOById(this.db, orgId, poId);
  }

  async getPOItems(
    orgId: string,
    poId: string,
  ): Promise<PurchaseOrderItemRow[]> {
    return this.repository.findPOItems(this.db, orgId, poId);
  }

  // ===========================================================================
  // Goods Receipt Commands
  // ===========================================================================

  async createGR(
    orgId: string,
    data: {
      purchaseOrderId: string;
      warehouseId: string;
      receivedDate?: Date;
      notes?: string | null;
      items: Array<{
        purchaseOrderItemId: string;
        variantId: string;
        quantityReceived: string;
        quantityAccepted: string;
        quantityRejected?: string;
        unitCost: string;
        notes?: string | null;
      }>;
      costs?: Array<{
        costType: string;
        amount: string;
        description?: string | null;
      }>;
    },
    idempotencyKey: string,
    principal: { id: string },
  ): Promise<GoodsReceiptRow> {
    const scope = `purchasing:createGR:${orgId}`;

    const result = await this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotency(
        tx,
        idempotencyKey,
        scope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED' && claim.responseJson) {
          return claim.responseJson as unknown as GoodsReceiptRow;
        }
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey },
        });
      }

      // Validate PO exists
      const po = await this.repository.findPOById(
        tx,
        orgId,
        data.purchaseOrderId,
      );
      if (!po) {
        throw PlatformError.notFound(
          `Purchase order ${data.purchaseOrderId} not found.`,
          {
            details: {
              purchaseOrderId: data.purchaseOrderId,
              organizationId: orgId,
            },
          },
        );
      }

      // Validate PO status is SENT or PARTIALLY_RECEIVED
      if (po.status !== 'SENT' && po.status !== 'PARTIALLY_RECEIVED') {
        throw PlatformError.of(
          ERROR_CODES.OPERATION_NOT_ALLOWED,
          `Cannot create goods receipt for purchase order in status "${po.status}". Must be SENT or PARTIALLY_RECEIVED.`,
          { details: { poId: po.id, status: po.status } },
        );
      }

      // Validate warehouse matches PO
      if (po.warehouseId !== data.warehouseId) {
        throw PlatformError.of(
          ERROR_CODES.VALIDATION_FAILED,
          `Goods receipt warehouse ${data.warehouseId} does not match purchase order warehouse ${po.warehouseId}.`,
          {
            details: {
              grWarehouseId: data.warehouseId,
              poWarehouseId: po.warehouseId,
            },
          },
        );
      }

      // Validate each PO item exists on the PO
      if (!data.items || data.items.length === 0) {
        throw PlatformError.of(
          ERROR_CODES.VALIDATION_FAILED,
          'Goods receipt must have at least one item.',
          { details: { itemCount: data.items?.length ?? 0 } },
        );
      }

      for (const item of data.items) {
        const poItem = await this.repository.findPOItemById(
          tx,
          orgId,
          item.purchaseOrderItemId,
        );
        if (!poItem || poItem.purchaseOrderId !== po.id) {
          throw PlatformError.of(
            ERROR_CODES.VALIDATION_FAILED,
            `Purchase order item ${item.purchaseOrderItemId} does not belong to purchase order ${po.id}.`,
            {
              details: {
                purchaseOrderItemId: item.purchaseOrderItemId,
                poId: po.id,
              },
            },
          );
        }
      }

      // Create GR aggregate (validates items, completeness, etc.)
      const { GoodsReceipt } = await import('../domain/goods-receipt');
      const { newId } = await import('@commerce-platform/database');
      const grId = newId();

      const aggregate = GoodsReceipt.create({
        id: grId,
        organizationId: orgId,
        purchaseOrderId: data.purchaseOrderId,
        warehouseId: data.warehouseId,
        receivedDate: data.receivedDate,
        notes: data.notes,
        items: data.items.map((item) => ({
          id: newId(),
          purchaseOrderItemId: item.purchaseOrderItemId,
          variantId: item.variantId,
          quantityReceived: parseFloat(item.quantityReceived),
          quantityAccepted: parseFloat(item.quantityAccepted),
          quantityRejected: item.quantityRejected
            ? parseFloat(item.quantityRejected)
            : undefined,
          unitCost: parseFloat(item.unitCost),
          notes: item.notes,
        })),
        costs: (data.costs ?? []).map((cost) => ({
          id: newId(),
          costType: cost.costType as
            | 'SHIPPING'
            | 'CUSTOMS'
            | 'HANDLING'
            | 'OTHER',
          amount: parseFloat(cost.amount),
          description: cost.description,
        })),
      });

      // Persist GR
      const grRow = await this.repository.createGR(tx, {
        id: aggregate.id,
        organizationId: orgId,
        purchaseOrderId: aggregate.purchaseOrderId,
        warehouseId: aggregate.warehouseId,
        status: aggregate.status,
        receivedDate: aggregate.receivedDate,
        notes: aggregate.notes,
      });

      // Persist GR items
      for (const item of aggregate.items) {
        await this.repository.createGRItem(tx, {
          id: item.id,
          organizationId: orgId,
          goodsReceiptId: grRow.id,
          purchaseOrderItemId: item.purchaseOrderItemId,
          variantId: item.variantId,
          quantityReceived: String(item.quantityReceived),
          quantityAccepted: String(item.quantityAccepted),
          quantityRejected: String(item.quantityRejected),
          unitCost: String(item.unitCost),
          notes: item.notes,
        });
      }

      // Persist GR costs
      for (const cost of aggregate.costs) {
        await this.repository.createGRCost(tx, {
          id: cost.id,
          organizationId: orgId,
          goodsReceiptId: grRow.id,
          costType: cost.costType,
          amount: String(cost.amount),
          description: cost.description,
        });
      }

      aggregate.markPersisted();
      const events = aggregate.pullDomainEvents();

      for (const event of events) {
        if (event.type === 'GoodsReceiptCreated') {
          await this.repository.writeOutbox(
            tx,
            purchasingEvent(
              'purchasing.goods-receipt-created',
              orgId,
              'GoodsReceipt',
              grRow.id,
              grRow.version,
              idempotencyKey,
              idempotencyKey,
              principal.id,
              {
                purchaseOrderId: data.purchaseOrderId,
                warehouseId: data.warehouseId,
                itemCount: aggregate.items.length,
                costCount: aggregate.costs.length,
              },
            ),
          );
        }
      }

      await this.repository.writeOutcome(tx, claim.claimId, 'COMPLETED', grRow as unknown as Record<string, unknown>);

      return grRow;
    });

    return result;
  }

  /**
   * Confirm a Goods Receipt: PENDING → CONFIRMED.
   *
   * CRITICAL FLOW:
   * 1. Validate GR is PENDING
   * 2. Confirm GR (immutable after this)
   * 3. Calculate landed cost per unit
   * 4. For each item with quantityAccepted > 0:
   *    → Call INVENTORY_CONTRACTS.receiveStock with landed cost
   *    → Update PO item received_quantity
   * 5. Update PO status (SENT → PARTIALLY_RECEIVED or RECEIVED)
   */
  async confirmGR(
    orgId: string,
    grId: string,
    idempotencyKey: string,
    principal: { id: string },
  ): Promise<GoodsReceiptRow> {
    const scope = `purchasing:confirmGR:${orgId}`;

    const result = await this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotency(
        tx,
        idempotencyKey,
        scope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED' && claim.responseJson) {
          return claim.responseJson as unknown as GoodsReceiptRow;
        }
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey },
        });
      }

      // Load GR
      const gr = await this.repository.findGRById(tx, orgId, grId);
      if (!gr) {
        throw PlatformError.notFound(`Goods receipt ${grId} not found.`, {
          details: { grId, organizationId: orgId },
        });
      }

      // Validate GR is PENDING
      if (gr.status !== 'PENDING') {
        throw PlatformError.of(
          ERROR_CODES.OPERATION_NOT_ALLOWED,
          `Cannot confirm goods receipt in status "${gr.status}". Must be PENDING.`,
          { details: { grId: gr.id, status: gr.status } },
        );
      }

      // Load GR items and costs
      const grItems = await this.repository.findGRItems(tx, orgId, grId);
      const grCosts = await this.repository.findGRCosts(tx, orgId, grId);

      // Confirm GR (PENDING → CONFIRMED)
      const now = new Date();
      const updatedGR = await this.repository.updateGR(
        tx,
        orgId,
        grId,
        {
          status: 'CONFIRMED',
          confirmedAt: now,
          confirmedBy: principal.id,
        },
        gr.version,
      );

      if (!updatedGR) {
        throw PlatformError.of(
          ERROR_CODES.RESOURCE_VERSION_CONFLICT,
          `Goods receipt ${grId} was modified concurrently.`,
          { details: { grId, expectedVersion: gr.version } },
        );
      }

      // Calculate landed cost per unit
      // Landed cost = unitCost + (totalAdditionalCosts / totalAcceptedQty)
      const totalAcceptedQty = grItems.reduce(
        (sum, item) => sum + parseFloat(item.quantityAccepted),
        0,
      );
      const totalAdditionalCosts = grCosts.reduce(
        (sum, cost) => sum + parseFloat(cost.amount),
        0,
      );

      // For each GR item with quantityAccepted > 0:
      for (const grItem of grItems) {
        const acceptedQty = parseFloat(grItem.quantityAccepted);
        if (acceptedQty <= 0) continue;

        const itemUnitCost = parseFloat(grItem.unitCost);
        const landedCostPerUnit = calculateLandedCost(
          itemUnitCost,
          grCosts.map((c) => ({ amount: parseFloat(c.amount) })),
          totalAcceptedQty,
        );

        // Call INVENTORY_CONTRACTS.receiveStock (cross-context call)
        await this.inventoryContracts.receiveStock({
          organizationId: orgId,
          warehouseId: gr.warehouseId,
          variantId: grItem.variantId,
          quantity: grItem.quantityAccepted,
          unitCost: String(landedCostPerUnit),
          referenceType: 'GOODS_RECEIPT',
          referenceId: grItem.id,
        });

        // Update PO item received_quantity (add quantityAccepted)
        const poItem = await this.repository.findPOItemById(
          tx,
          orgId,
          grItem.purchaseOrderItemId,
        );

        if (poItem) {
          const currentReceived = parseFloat(poItem.receivedQuantity);
          const newReceived = currentReceived + acceptedQty;
          await this.repository.updatePOItem(
            tx,
            orgId,
            grItem.purchaseOrderItemId,
            { receivedQuantity: String(newReceived) },
          );
        }
      }

      // Update PO status
      // Check if all PO items are fully received
      const poItems = await this.repository.findPOItems(
        tx,
        orgId,
        gr.purchaseOrderId,
      );

      const allFullyReceived = poItems.every((item) => {
        const ordered = parseFloat(item.quantity);
        // After our updates above, re-read the item from DB to get the latest receivedQuantity
        return parseFloat(item.receivedQuantity) >= ordered;
      });

      // Re-read PO to get current version after any updates
      const currentPO = await this.repository.findPOById(
        tx,
        orgId,
        gr.purchaseOrderId,
      );

      if (currentPO) {
        let newPOStatus: string;
        if (allFullyReceived) {
          newPOStatus = 'RECEIVED';
        } else {
          newPOStatus = 'PARTIALLY_RECEIVED';
        }

        // Validate the transition
        validatePOStatusTransition(currentPO.status, newPOStatus);

        await this.repository.updatePO(
          tx,
          orgId,
          gr.purchaseOrderId,
          { status: newPOStatus },
          currentPO.version,
        );
      }

      // Write outbox events
      await this.repository.writeOutbox(
        tx,
        purchasingEvent(
          'purchasing.goods-receipt-confirmed',
          orgId,
          'GoodsReceipt',
          updatedGR.id,
          updatedGR.version,
          idempotencyKey,
          idempotencyKey,
          principal.id,
          {
            purchaseOrderId: gr.purchaseOrderId,
            warehouseId: gr.warehouseId,
            totalAcceptedQuantity: totalAcceptedQty,
            totalAdditionalCosts,
          },
        ),
      );

      await this.repository.writeOutcome(tx, claim.claimId, 'COMPLETED', updatedGR as unknown as Record<string, unknown>);

      return updatedGR;
    });

    return result;
  }

  async cancelGR(
    orgId: string,
    grId: string,
    reason: string | null,
    idempotencyKey: string,
    principal: { id: string },
  ): Promise<GoodsReceiptRow> {
    const scope = `purchasing:cancelGR:${orgId}`;

    const result = await this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotency(
        tx,
        idempotencyKey,
        scope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED' && claim.responseJson) {
          return claim.responseJson as unknown as GoodsReceiptRow;
        }
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey },
        });
      }

      const existing = await this.repository.findGRById(tx, orgId, grId);
      if (!existing) {
        throw PlatformError.notFound(`Goods receipt ${grId} not found.`, {
          details: { grId, organizationId: orgId },
        });
      }

      if (existing.status !== 'PENDING') {
        throw PlatformError.of(
          ERROR_CODES.OPERATION_NOT_ALLOWED,
          `Cannot cancel goods receipt in status "${existing.status}". Must be PENDING.`,
          { details: { grId: existing.id, status: existing.status } },
        );
      }

      const updated = await this.repository.updateGR(
        tx,
        orgId,
        grId,
        { status: 'CANCELLED' },
        existing.version,
      );

      if (!updated) {
        throw PlatformError.of(
          ERROR_CODES.RESOURCE_VERSION_CONFLICT,
          `Goods receipt ${grId} was modified concurrently.`,
          { details: { grId, expectedVersion: existing.version } },
        );
      }

      await this.repository.writeOutbox(
        tx,
        purchasingEvent(
          'purchasing.goods-receipt-cancelled',
          orgId,
          'GoodsReceipt',
          updated.id,
          updated.version,
          idempotencyKey,
          idempotencyKey,
          principal.id,
          { reason: reason ?? null },
        ),
      );

      await this.repository.writeOutcome(tx, claim.claimId, 'COMPLETED', updated as unknown as Record<string, unknown>);

      return updated;
    });

    return result;
  }

  // ===========================================================================
  // Goods Receipt Queries
  // ===========================================================================

  async listGRs(
    orgId: string,
    poId?: string,
    limit?: number,
    offset?: number,
  ): Promise<GoodsReceiptRow[]> {
    return this.repository.listGRs(this.db, orgId, poId, limit, offset);
  }

  async getGRById(
    orgId: string,
    grId: string,
  ): Promise<GoodsReceiptRow | null> {
    return this.repository.findGRById(this.db, orgId, grId);
  }

  async getGRItems(
    orgId: string,
    grId: string,
  ): Promise<GoodsReceiptItemRow[]> {
    return this.repository.findGRItems(this.db, orgId, grId);
  }

  async getGRCosts(
    orgId: string,
    grId: string,
  ): Promise<PurchaseCostRow[]> {
    return this.repository.findGRCosts(this.db, orgId, grId);
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Generic PO status transition helper for simple status changes
   * (SUBMITTED, APPROVED, SENT) that don't require additional logic.
   */
  private async transitionPO(
    orgId: string,
    poId: string,
    targetStatus: string,
    idempotencyKey: string,
    principal: { id: string },
    eventType: PurchasingEventType,
  ): Promise<PurchaseOrderRow> {
    const scope = `purchasing:transitionPO:${targetStatus}:${orgId}`;

    const result = await this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotency(
        tx,
        idempotencyKey,
        scope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED' && claim.responseJson) {
          return claim.responseJson as unknown as PurchaseOrderRow;
        }
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey },
        });
      }

      const existing = await this.repository.findPOById(tx, orgId, poId);
      if (!existing) {
        throw PlatformError.notFound(`Purchase order ${poId} not found.`, {
          details: { poId, organizationId: orgId },
        });
      }

      validatePOStatusTransition(existing.status, targetStatus);

      const updated = await this.repository.updatePO(
        tx,
        orgId,
        poId,
        { status: targetStatus },
        existing.version,
      );

      if (!updated) {
        throw PlatformError.of(
          ERROR_CODES.RESOURCE_VERSION_CONFLICT,
          `Purchase order ${poId} was modified concurrently.`,
          { details: { poId, expectedVersion: existing.version } },
        );
      }

      await this.repository.writeOutbox(
        tx,
        purchasingEvent(
          eventType,
          orgId,
          'PurchaseOrder',
          updated.id,
          updated.version,
          idempotencyKey,
          idempotencyKey,
          principal.id,
          {},
        ),
      );

      await this.repository.writeOutcome(tx, claim.claimId, 'COMPLETED', updated as unknown as Record<string, unknown>);

      return updated;
    });

    return result;
  }
}
