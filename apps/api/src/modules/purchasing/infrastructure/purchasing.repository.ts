import {
  suppliers,
  purchaseOrders,
  purchaseOrderItems,
  goodsReceipts,
  goodsReceiptItems,
  purchaseCosts,
  integrationOutbox,
  idempotencyOutcomes,
  newId,
} from '@commerce-platform/database';
import { and, asc, eq } from 'drizzle-orm';

import { PURCHASING_AGGREGATE_TYPE } from '../domain/events';
import type { DbExecutor } from './db-executor';
import { purchasingEvent } from './event-envelope';

/**
 * Repository for the Purchasing bounded context.
 *
 * Every method takes an explicit {@link DbExecutor} so the application
 * service controls the transaction boundary.
 * Every tenant-owned access is `organizationId`-scoped; child rows are only
 * ever loaded/written through their owning organization.
 */
export class PurchasingRepository {
  // ---------------------------------------------------------------------------
  // Suppliers
  // ---------------------------------------------------------------------------

  async findSupplierById(
    executor: DbExecutor,
    organizationId: string,
    supplierId: string,
  ): Promise<SupplierRow | null> {
    const [row] = await executor
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, organizationId)))
      .limit(1);

    return (row as SupplierRow | undefined) ?? null;
  }

  async findSupplierByCode(
    executor: DbExecutor,
    organizationId: string,
    code: string,
  ): Promise<SupplierRow | null> {
    const [row] = await executor
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.organizationId, organizationId), eq(suppliers.code, code)))
      .limit(1);

    return (row as SupplierRow | undefined) ?? null;
  }

  async listSuppliers(
    executor: DbExecutor,
    organizationId: string,
    limit?: number,
    offset?: number,
  ): Promise<SupplierRow[]> {
    const rows = await executor
      .select()
      .from(suppliers)
      .where(eq(suppliers.organizationId, organizationId))
      .orderBy(asc(suppliers.createdAt))
      .limit(limit ?? 50)
      .offset(offset ?? 0);

    return rows as unknown as SupplierRow[];
  }

  async createSupplier(
    executor: DbExecutor,
    data: {
      id?: string;
      organizationId: string;
      name: string;
      code: string;
      contactName?: string | null;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
      isActive?: boolean;
      notes?: string | null;
    },
  ): Promise<SupplierRow> {
    const id = data.id ?? newId();
    const [row] = await executor
      .insert(suppliers)
      .values({
        id,
        organizationId: data.organizationId,
        name: data.name,
        code: data.code,
        contactName: data.contactName ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        address: data.address ?? null,
        isActive: data.isActive ?? true,
        notes: data.notes ?? null,
      })
      .returning();

    return row as unknown as SupplierRow;
  }

  async updateSupplier(
    executor: DbExecutor,
    organizationId: string,
    supplierId: string,
    data: {
      name?: string;
      contactName?: string | null;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
      notes?: string | null;
      isActive?: boolean;
    },
    version: number,
  ): Promise<SupplierRow | null> {
    const updated = await executor
      .update(suppliers)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.contactName !== undefined ? { contactName: data.contactName } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        updatedAt: new Date(),
        version: version + 1,
      })
      .where(
        and(
          eq(suppliers.id, supplierId),
          eq(suppliers.organizationId, organizationId),
          eq(suppliers.version, version),
        ),
      )
      .returning();

    return (updated[0] as SupplierRow | undefined) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Purchase Orders
  // ---------------------------------------------------------------------------

  async findPOById(
    executor: DbExecutor,
    organizationId: string,
    poId: string,
  ): Promise<PurchaseOrderRow | null> {
    const [row] = await executor
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.organizationId, organizationId)))
      .limit(1);

    return (row as PurchaseOrderRow | undefined) ?? null;
  }

  async listPOs(
    executor: DbExecutor,
    organizationId: string,
    status?: string,
    limit?: number,
    offset?: number,
  ): Promise<PurchaseOrderRow[]> {
    const conditions = [eq(purchaseOrders.organizationId, organizationId)];
    if (status) {
      conditions.push(eq(purchaseOrders.status, status));
    }

    const rows = await executor
      .select()
      .from(purchaseOrders)
      .where(and(...conditions))
      .orderBy(asc(purchaseOrders.createdAt))
      .limit(limit ?? 50)
      .offset(offset ?? 0);

    return rows as unknown as PurchaseOrderRow[];
  }

  async createPO(
    executor: DbExecutor,
    data: {
      id?: string;
      organizationId: string;
      supplierId: string;
      warehouseId: string;
      status?: string;
      orderDate?: Date;
      expectedDeliveryDate?: Date | null;
      notes?: string | null;
    },
  ): Promise<PurchaseOrderRow> {
    const id = data.id ?? newId();
    const [row] = await executor
      .insert(purchaseOrders)
      .values({
        id,
        organizationId: data.organizationId,
        supplierId: data.supplierId,
        warehouseId: data.warehouseId,
        status: data.status ?? 'DRAFT',
        orderDate: data.orderDate ?? new Date(),
        expectedDeliveryDate: data.expectedDeliveryDate ?? null,
        notes: data.notes ?? null,
      })
      .returning();

    return row as unknown as PurchaseOrderRow;
  }

  async updatePO(
    executor: DbExecutor,
    organizationId: string,
    poId: string,
    data: {
      status?: string;
      notes?: string | null;
      expectedDeliveryDate?: Date | null;
    },
    version: number,
  ): Promise<PurchaseOrderRow | null> {
    const updated = await executor
      .update(purchaseOrders)
      .set({
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.expectedDeliveryDate !== undefined
          ? { expectedDeliveryDate: data.expectedDeliveryDate }
          : {}),
        updatedAt: new Date(),
        version: version + 1,
      })
      .where(
        and(
          eq(purchaseOrders.id, poId),
          eq(purchaseOrders.organizationId, organizationId),
          eq(purchaseOrders.version, version),
        ),
      )
      .returning();

    return (updated[0] as PurchaseOrderRow | undefined) ?? null;
  }

  async findPOItems(
    executor: DbExecutor,
    organizationId: string,
    poId: string,
  ): Promise<PurchaseOrderItemRow[]> {
    const rows = await executor
      .select()
      .from(purchaseOrderItems)
      .where(
        and(
          eq(purchaseOrderItems.purchaseOrderId, poId),
          eq(purchaseOrderItems.organizationId, organizationId),
        ),
      )
      .orderBy(asc(purchaseOrderItems.createdAt));

    return rows as unknown as PurchaseOrderItemRow[];
  }

  async findPOItemById(
    executor: DbExecutor,
    organizationId: string,
    itemId: string,
  ): Promise<PurchaseOrderItemRow | null> {
    const [row] = await executor
      .select()
      .from(purchaseOrderItems)
      .where(
        and(
          eq(purchaseOrderItems.id, itemId),
          eq(purchaseOrderItems.organizationId, organizationId),
        ),
      )
      .limit(1);

    return (row as PurchaseOrderItemRow | undefined) ?? null;
  }

  async createPOItem(
    executor: DbExecutor,
    data: {
      id?: string;
      organizationId: string;
      purchaseOrderId: string;
      variantId: string;
      quantity: string;
      unitCost: string;
      packagingUnit?: string | null;
      packagingQuantity?: string | null;
      packagingConversion?: string | null;
      notes?: string | null;
    },
  ): Promise<PurchaseOrderItemRow> {
    const id = data.id ?? newId();
    const [row] = await executor
      .insert(purchaseOrderItems)
      .values({
        id,
        organizationId: data.organizationId,
        purchaseOrderId: data.purchaseOrderId,
        variantId: data.variantId,
        quantity: data.quantity,
        unitCost: data.unitCost,
        packagingUnit: data.packagingUnit ?? null,
        packagingQuantity: data.packagingQuantity ?? null,
        packagingConversion: data.packagingConversion ?? null,
        notes: data.notes ?? null,
      })
      .returning();

    return row as unknown as PurchaseOrderItemRow;
  }

  async updatePOItem(
    executor: DbExecutor,
    organizationId: string,
    itemId: string,
    data: {
      receivedQuantity?: string;
    },
  ): Promise<PurchaseOrderItemRow | null> {
    const updated = await executor
      .update(purchaseOrderItems)
      .set({
        ...(data.receivedQuantity !== undefined ? { receivedQuantity: data.receivedQuantity } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(purchaseOrderItems.id, itemId),
          eq(purchaseOrderItems.organizationId, organizationId),
        ),
      )
      .returning();

    return (updated[0] as PurchaseOrderItemRow | undefined) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Goods Receipts
  // ---------------------------------------------------------------------------

  async findGRById(
    executor: DbExecutor,
    organizationId: string,
    grId: string,
  ): Promise<GoodsReceiptRow | null> {
    const [row] = await executor
      .select()
      .from(goodsReceipts)
      .where(and(eq(goodsReceipts.id, grId), eq(goodsReceipts.organizationId, organizationId)))
      .limit(1);

    return (row as GoodsReceiptRow | undefined) ?? null;
  }

  async listGRs(
    executor: DbExecutor,
    organizationId: string,
    poId?: string,
    limit?: number,
    offset?: number,
  ): Promise<GoodsReceiptRow[]> {
    const conditions = [eq(goodsReceipts.organizationId, organizationId)];
    if (poId) {
      conditions.push(eq(goodsReceipts.purchaseOrderId, poId));
    }

    const rows = await executor
      .select()
      .from(goodsReceipts)
      .where(and(...conditions))
      .orderBy(asc(goodsReceipts.createdAt))
      .limit(limit ?? 50)
      .offset(offset ?? 0);

    return rows as unknown as GoodsReceiptRow[];
  }

  async createGR(
    executor: DbExecutor,
    data: {
      id?: string;
      organizationId: string;
      purchaseOrderId: string;
      warehouseId: string;
      status?: string;
      receivedDate?: Date;
      notes?: string | null;
    },
  ): Promise<GoodsReceiptRow> {
    const id = data.id ?? newId();
    const [row] = await executor
      .insert(goodsReceipts)
      .values({
        id,
        organizationId: data.organizationId,
        purchaseOrderId: data.purchaseOrderId,
        warehouseId: data.warehouseId,
        status: data.status ?? 'PENDING',
        receivedDate: data.receivedDate ?? new Date(),
        notes: data.notes ?? null,
      })
      .returning();

    return row as unknown as GoodsReceiptRow;
  }

  async updateGR(
    executor: DbExecutor,
    organizationId: string,
    grId: string,
    data: {
      status?: string;
      confirmedAt?: Date | null;
      confirmedBy?: string | null;
    },
    version: number,
  ): Promise<GoodsReceiptRow | null> {
    const updated = await executor
      .update(goodsReceipts)
      .set({
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.confirmedAt !== undefined ? { confirmedAt: data.confirmedAt } : {}),
        ...(data.confirmedBy !== undefined ? { confirmedBy: data.confirmedBy } : {}),
        updatedAt: new Date(),
        version: version + 1,
      })
      .where(
        and(
          eq(goodsReceipts.id, grId),
          eq(goodsReceipts.organizationId, organizationId),
          eq(goodsReceipts.version, version),
        ),
      )
      .returning();

    return (updated[0] as GoodsReceiptRow | undefined) ?? null;
  }

  async findGRItems(
    executor: DbExecutor,
    organizationId: string,
    grId: string,
  ): Promise<GoodsReceiptItemRow[]> {
    const rows = await executor
      .select()
      .from(goodsReceiptItems)
      .where(
        and(
          eq(goodsReceiptItems.goodsReceiptId, grId),
          eq(goodsReceiptItems.organizationId, organizationId),
        ),
      )
      .orderBy(asc(goodsReceiptItems.createdAt));

    return rows as unknown as GoodsReceiptItemRow[];
  }

  async createGRItem(
    executor: DbExecutor,
    data: {
      id?: string;
      organizationId: string;
      goodsReceiptId: string;
      purchaseOrderItemId: string;
      variantId: string;
      quantityReceived: string;
      quantityAccepted: string;
      quantityRejected?: string;
      unitCost: string;
      notes?: string | null;
    },
  ): Promise<GoodsReceiptItemRow> {
    const id = data.id ?? newId();
    const [row] = await executor
      .insert(goodsReceiptItems)
      .values({
        id,
        organizationId: data.organizationId,
        goodsReceiptId: data.goodsReceiptId,
        purchaseOrderItemId: data.purchaseOrderItemId,
        variantId: data.variantId,
        quantityReceived: data.quantityReceived,
        quantityAccepted: data.quantityAccepted,
        quantityRejected: data.quantityRejected ?? '0',
        unitCost: data.unitCost,
        notes: data.notes ?? null,
      })
      .returning();

    return row as unknown as GoodsReceiptItemRow;
  }

  async findGRCosts(
    executor: DbExecutor,
    organizationId: string,
    grId: string,
  ): Promise<PurchaseCostRow[]> {
    const rows = await executor
      .select()
      .from(purchaseCosts)
      .where(
        and(
          eq(purchaseCosts.goodsReceiptId, grId),
          eq(purchaseCosts.organizationId, organizationId),
        ),
      )
      .orderBy(asc(purchaseCosts.createdAt));

    return rows as unknown as PurchaseCostRow[];
  }

  async createGRCost(
    executor: DbExecutor,
    data: {
      id?: string;
      organizationId: string;
      goodsReceiptId: string;
      costType: string;
      amount: string;
      currency?: string;
      description?: string | null;
    },
  ): Promise<PurchaseCostRow> {
    const id = data.id ?? newId();
    const [row] = await executor
      .insert(purchaseCosts)
      .values({
        id,
        organizationId: data.organizationId,
        goodsReceiptId: data.goodsReceiptId,
        costType: data.costType,
        amount: data.amount,
        currency: data.currency ?? 'USD',
        description: data.description ?? null,
      })
      .returning();

    return row as unknown as PurchaseCostRow;
  }

  // ---------------------------------------------------------------------------
  // Outbox (transactional)
  // ---------------------------------------------------------------------------

  /**
   * Write integration events to the outbox. Events go out LAST within
   * the transaction: readers of the outbox must never observe an event
   * for state that is not committed alongside it.
   */
  async writeOutbox(
    executor: DbExecutor,
    envelope: ReturnType<typeof purchasingEvent>,
  ): Promise<void> {
    await executor.insert(integrationOutbox).values({
      id: newId(),
      aggregateType: PURCHASING_AGGREGATE_TYPE,
      aggregateId: envelope.aggregateId,
      eventType: envelope.eventType,
      payload: envelope,
      correlationId: envelope.correlationId,
      occurredAt: new Date(envelope.occurredAt),
    });
  }

  /**
   * Write multiple integration events to the outbox in one insert.
   */
  async writeOutboxEvents(
    executor: DbExecutor,
    events: ReturnType<typeof purchasingEvent>[],
  ): Promise<void> {
    if (events.length === 0) return;

    await executor.insert(integrationOutbox).values(
      events.map((envelope) => ({
        id: newId(),
        aggregateType: PURCHASING_AGGREGATE_TYPE,
        aggregateId: envelope.aggregateId,
        eventType: envelope.eventType,
        payload: envelope,
        correlationId: envelope.correlationId,
        occurredAt: new Date(envelope.occurredAt),
      })),
    );
  }

  // ---------------------------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------------------------

  /**
   * Claim an idempotency key within the current transaction.
   * Returns a claim result with the existing outcome (if any) or a new claim ID.
   */
  async claimIdempotency(
    executor: DbExecutor,
    key: string,
    scope: string,
  ): Promise<IdempotencyClaimResult> {
    // Check for existing outcome first
    const [existing] = await executor
      .select()
      .from(idempotencyOutcomes)
      .where(and(eq(idempotencyOutcomes.idempotencyKey, key), eq(idempotencyOutcomes.scope, scope)))
      .limit(1);

    if (existing) {
      return {
        kind: 'existing',
        claimId: existing.id,
        status: existing.status,
        responseJson: existing.responseJson as Record<string, unknown> | null,
      };
    }

    // Insert new claim (will fail on unique constraint if concurrent)
    const id = newId();
    await executor.insert(idempotencyOutcomes).values({
      id,
      scope,
      idempotencyKey: key,
      requestHash: key,
      status: 'IN_PROGRESS',
    });

    return { kind: 'claimed', claimId: id };
  }

  /**
   * Record the outcome of an idempotent operation.
   */
  async writeOutcome(
    executor: DbExecutor,
    claimId: string,
    statusCode: string,
    body: Record<string, unknown> | null,
  ): Promise<void> {
    await executor
      .update(idempotencyOutcomes)
      .set({
        status: statusCode,
        responseJson: body ?? null,
        completedAt: new Date(),
      })
      .where(eq(idempotencyOutcomes.id, claimId));
  }
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface SupplierRow {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface PurchaseOrderRow {
  id: string;
  organizationId: string;
  supplierId: string;
  status: string;
  warehouseId: string;
  orderDate: Date;
  expectedDeliveryDate: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface PurchaseOrderItemRow {
  id: string;
  organizationId: string;
  purchaseOrderId: string;
  variantId: string;
  quantity: string;
  receivedQuantity: string;
  unitCost: string;
  packagingUnit: string | null;
  packagingQuantity: string | null;
  packagingConversion: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GoodsReceiptRow {
  id: string;
  organizationId: string;
  purchaseOrderId: string;
  warehouseId: string;
  status: string;
  receivedDate: Date;
  notes: string | null;
  confirmedAt: Date | null;
  confirmedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface GoodsReceiptItemRow {
  id: string;
  organizationId: string;
  goodsReceiptId: string;
  purchaseOrderItemId: string;
  variantId: string;
  quantityReceived: string;
  quantityAccepted: string;
  quantityRejected: string;
  unitCost: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PurchaseCostRow {
  id: string;
  organizationId: string;
  goodsReceiptId: string;
  costType: string;
  amount: string;
  currency: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IdempotencyClaimResult =
  | {
      kind: 'existing';
      claimId: string;
      status: string;
      responseJson: Record<string, unknown> | null;
    }
  | {
      kind: 'claimed';
      claimId: string;
    };
