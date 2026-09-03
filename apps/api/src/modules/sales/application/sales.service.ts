import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import {
  newId,
  type DatabaseClient,
  type SaleItemRow,
  type SaleRow,
} from '@commerce-platform/database';
import { Inject, Injectable } from '@nestjs/common';

import { CATALOG_CONTRACTS, type CatalogContracts } from '../../catalog/contracts';
import {
  CART_CHECKOUT_CONTRACTS,
  type CartCheckoutContracts,
  type CartCheckoutView,
} from '../../cart/contracts';
import { requestHash } from '../../cart/application/cart.service';
import { CUSTOMERS_CONTRACTS, type CustomersContracts } from '../../customers/contracts';
import { DATABASE } from '../../database/database.tokens';
import {
  INVENTORY_CONTRACTS,
  INVENTORY_MUTATION_CONTRACTS,
  type InventoryContracts,
  type InventoryMutationContracts,
} from '../../inventory/contracts';
import { PRICING_CONTRACTS, type PricingContracts } from '../../pricing/contracts';
import type { SaleView } from '../contracts';
import { Sale, type SaleItemState, type SaleState } from '../domain/sale';
import { SalesRepository, type SaleRecord } from '../infrastructure/sales.repository';
import { salesEvent } from '../infrastructure/event-envelope';

type PriceType = 'CASH' | 'WHOLESALE' | 'CREDIT' | 'ONLINE';

interface CreateSaleInput {
  organizationId: string;
  cartId: string;
  cartVersion: number;
  warehouseId?: string;
  priceType?: PriceType;
  idempotencyKey: string;
  actorId: string;
  correlationId: string;
  causationId: string;
}

interface CancelSaleInput {
  organizationId: string;
  saleId: string;
  idempotencyKey: string;
  actorId: string;
  correlationId: string;
  causationId: string;
  reason: string;
}

interface CompleteSaleInput {
  organizationId: string;
  saleId: string;
  completionReferenceType: string;
  completionReferenceId: string;
  idempotencyKey: string;
  actorId: string;
  correlationId: string;
  causationId: string;
}

interface LineSnapshot {
  item: CartCheckoutView['items'][number];
  variant: Awaited<ReturnType<CatalogContracts['getVariant']>> extends infer T
    ? Exclude<T, null>
    : never;
  product: Awaited<ReturnType<CatalogContracts['getProduct']>> extends infer T
    ? Exclude<T, null>
    : never;
  baseQuantity: string;
  unitPrice: string;
  lineSubtotal: string;
  discountTotal: string;
  taxTotal: string;
  lineTotal: string;
  pricingSource: 'BRANCH' | 'ORGANIZATIONAL';
}

type ReservationBinding =
  | {
      reservationId: string;
      warehouseId: string;
      status: 'ACTIVE';
      referenceType: 'PENDING_SALE';
      referenceId: string;
    }
  | { reservationId: string; status: 'ACTIVE'; referenceType: 'PENDING_SALE'; referenceId: string };

@Injectable()
export class SalesService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(SalesRepository) private readonly repository: SalesRepository,
    @Inject(CART_CHECKOUT_CONTRACTS) private readonly carts: CartCheckoutContracts,
    @Inject(CATALOG_CONTRACTS) private readonly catalog: CatalogContracts,
    @Inject(CUSTOMERS_CONTRACTS) private readonly customers: CustomersContracts,
    @Inject(INVENTORY_CONTRACTS) private readonly inventory: InventoryContracts,
    @Inject(INVENTORY_MUTATION_CONTRACTS)
    private readonly inventoryMutations: InventoryMutationContracts,
    @Inject(PRICING_CONTRACTS) private readonly pricing: PricingContracts,
  ) {}

  async getSale(organizationId: string, saleId: string): Promise<SaleView | null> {
    const record = await this.repository.findSale(this.db, organizationId, saleId);
    return record ? toSaleView(record) : null;
  }

  async createSale(input: CreateSaleInput): Promise<SaleView> {
    const operation = 'POST:/api/v1/pos/sales';
    const semanticHash = requestHash({
      cartId: input.cartId,
      cartVersion: input.cartVersion,
      warehouseId: input.warehouseId ?? null,
      priceType: input.priceType ?? 'CASH',
    });
    const scope = `ORGANIZATION_USER:${input.actorId}:${input.organizationId}:${operation}`;
    const replay = await this.repository.findIdempotency(this.db, input.idempotencyKey, scope);
    if (replay) return this.replaySale(replay, semanticHash);

    const cartSnapshot = await this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotency(
        tx,
        input.idempotencyKey,
        scope,
        semanticHash,
      );
      if (claim.kind === 'existing') return this.replaySale(claim, semanticHash);

      const cart = await this.carts.lockDraftCartForCheckout(
        tx,
        input.organizationId,
        input.cartId,
      );
      if (!cart) {
        const existing = await this.carts.getCart(input.organizationId, input.cartId);
        if (existing?.status === 'CHECKED_OUT') {
          throw PlatformError.versionConflict(`Cart ${input.cartId} was already checked out.`, {
            details: { cartId: input.cartId, expectedVersion: input.cartVersion },
          });
        }
        throw PlatformError.notFound('Cart was not found.', { details: { cartId: input.cartId } });
      }
      if (cart.version !== input.cartVersion) {
        throw PlatformError.versionConflict(`Cart ${input.cartId} was modified concurrently.`, {
          details: { cartId: input.cartId, expectedVersion: input.cartVersion },
        });
      }
      if (cart.items.length === 0) {
        throw PlatformError.validationFailed('Cannot checkout an empty Cart.', {
          details: { cartId: input.cartId },
        });
      }

      const customer = cart.customerId
        ? await this.customers.getCustomer(input.organizationId, cart.customerId)
        : null;
      if (cart.customerId && !customer) {
        throw PlatformError.notFound('Customer reference was not found in this organization.', {
          details: { customerId: cart.customerId },
        });
      }

      const lineSnapshots = await Promise.all(
        cart.items.map(async (item) => {
          const variant = await this.catalog.getVariant(input.organizationId, item.variantId);
          if (!variant)
            throw PlatformError.notFound('Variant was not found.', {
              details: { variantId: item.variantId },
            });
          const product = await this.catalog.getProduct(input.organizationId, variant.productId);
          if (!product)
            throw PlatformError.notFound('Product was not found.', {
              details: { productId: variant.productId },
            });
          const baseQuantity =
            item.unitId === variant.baseUnitId
              ? item.quantity
              : await this.catalog.convertUnit(
                  input.organizationId,
                  item.unitId,
                  variant.baseUnitId,
                  item.quantity,
                );
          const quote = await this.pricing.getPriceQuote(input.organizationId, {
            variantId: item.variantId,
            unitId: item.unitId,
            priceType: input.priceType ?? 'CASH',
            channel: 'POS',
            branchId: cart.branchId,
          });
          const lineSubtotal = multiply(quote.amount, item.quantity);
          return {
            item,
            variant,
            product,
            baseQuantity,
            unitPrice: toEight(quote.amount),
            lineSubtotal,
            discountTotal: '0.00000000',
            taxTotal: '0.00000000',
            lineTotal: lineSubtotal,
            pricingSource: quote.source,
          };
        }),
      );

      const saleId = newId();
      const reservation = await this.obtainReservation(tx, { cart, lineSnapshots, input, saleId });
      const saleNumber = await this.repository.nextSaleNumber(tx, input.organizationId);
      const subtotal = lineSnapshots.reduce(
        (sum, line) => add(sum, line.lineSubtotal),
        '0.00000000',
      );
      const total = subtotal;
      const sale = Sale.create({
        id: saleId,
        organizationId: input.organizationId,
        branchId: cart.branchId,
        warehouseId:
          'warehouseId' in reservation
            ? reservation.warehouseId
            : (cart.hold?.warehouseId ?? input.warehouseId ?? null),
        cartId: cart.id,
        cartVersion: cart.version,
        customerId: customer?.id ?? null,
        customerType: customer?.type ?? null,
        customerDisplayName: customer?.displayName ?? null,
        customerCode: customer?.code ?? null,
        operatorId: input.actorId,
        deviceId: null,
        saleNumber,
        status: 'PENDING_PAYMENT',
        priceType: input.priceType ?? 'CASH',
        currency: 'EGP',
        subtotal,
        discountTotal: '0.00000000',
        taxTotal: '0.00000000',
        total,
        inventoryReservationId: reservation.reservationId,
        inventoryAllocationId: null,
        completionReferenceType: null,
        completionReferenceId: null,
        completedAt: null,
        cancelledAt: null,
        cancellationReason: null,
        cancelledBy: null,
        correlationId: input.correlationId,
        causationId: input.causationId,
        version: 1,
        items: lineSnapshots.map((line) => ({
          id: newId(),
          cartItemId: line.item.id,
          productId: line.product.id,
          variantId: line.variant.id,
          productName: line.product.name,
          variantName: line.variant.name,
          snapshotLabel: `${line.product.name} / ${line.variant.name}`,
          sku: line.variant.sku,
          barcode: line.variant.barcode,
          unitId: line.item.unitId,
          baseUnitId: line.variant.baseUnitId,
          quantity: line.item.quantity,
          baseQuantity: line.baseQuantity,
          unitPrice: line.unitPrice,
          lineSubtotal: line.lineSubtotal,
          discountTotal: '0.00000000',
          taxTotal: '0.00000000',
          lineTotal: line.lineTotal,
          currency: 'EGP',
          priceType: input.priceType ?? 'CASH',
          pricingSource: line.pricingSource,
          pricingReference: `${line.variant.id}:${line.item.unitId}:${input.priceType ?? 'CASH'}:POS:${cart.branchId}`,
        })),
      });

      const saleRow = await this.repository.createSale(tx, toSaleInsert(sale.snapshot));
      await this.repository.createSaleItems(
        tx,
        toSaleItemInserts(input.organizationId, saleId, sale.snapshot.items),
      );
      await this.carts.markCartCheckedOut(tx, {
        organizationId: input.organizationId,
        cartId: cart.id,
        expectedVersion: cart.version,
        holdId: cart.hold?.id,
      });

      const events = sale.pullDomainEvents().map((event) =>
        salesEvent({
          eventType:
            event.type === 'SaleCreated'
              ? 'sales.sale-created'
              : event.type === 'SaleCancelled'
                ? 'sales.sale-cancelled'
                : 'sales.sale-completed',
          organizationId: event.organizationId,
          aggregateId: event.aggregateId,
          aggregateVersion: event.aggregateVersion,
          correlationId: input.correlationId,
          causationId: input.causationId,
          actorId: input.actorId,
          payload:
            event.type === 'SaleCreated'
              ? { cartId: event.cartId, reservationId: event.reservationId }
              : {},
          occurredAt: event.occurredAt,
        }),
      );
      await this.repository.writeEvents(tx, events);
      const record = await this.repository.findSale(tx, input.organizationId, saleRow.id);
      if (!record)
        throw PlatformError.notFound('Sale was not found after creation.', {
          details: { saleId: saleRow.id },
        });
      const result = toSaleView(record);
      await this.repository.completeIdempotency(
        tx,
        claim.claimId,
        result as unknown as Record<string, unknown>,
      );
      return result;
    });
    return cartSnapshot;
  }

  async cancelSale(input: CancelSaleInput): Promise<SaleView> {
    const scope = `ORGANIZATION_USER:${input.actorId}:${input.organizationId}:POST:/api/v1/pos/sales/:saleId/cancel`;
    const semanticHash = requestHash({ saleId: input.saleId, reason: input.reason });
    const replay = await this.repository.findIdempotency(this.db, input.idempotencyKey, scope);
    if (replay) return this.replaySale(replay, semanticHash);

    return this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotency(
        tx,
        input.idempotencyKey,
        scope,
        semanticHash,
      );
      if (claim.kind === 'existing') return this.replaySale(claim, semanticHash);
      const record = await this.repository.lockSale(tx, input.organizationId, input.saleId);
      if (!record)
        throw PlatformError.notFound('Sale was not found.', { details: { saleId: input.saleId } });
      if (record.sale.status === 'CANCELLED') {
        const result = toSaleView(record);
        await this.repository.completeIdempotency(
          tx,
          claim.claimId,
          result as unknown as Record<string, unknown>,
        );
        return result;
      }
      if (record.sale.status === 'COMPLETED') {
        throw PlatformError.of(
          ERROR_CODES.SALE_INVALID_STATE,
          'Completed Sale cannot be cancelled.',
          { details: { saleId: input.saleId, status: record.sale.status } },
        );
      }
      await this.inventoryMutations.releaseReservationByIdInTransaction(tx, {
        organizationId: input.organizationId,
        reservationId: record.sale.inventoryReservationId ?? '',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
      const aggregate = Sale.reconstitute(fromRecord(record));
      aggregate.cancel(input.reason, input.actorId);
      const state = aggregate.snapshot;
      const updated = await this.repository.updateSale(
        tx,
        input.organizationId,
        input.saleId,
        record.sale.version,
        {
          status: state.status,
          cancelledAt: state.cancelledAt,
          cancellationReason: state.cancellationReason,
          cancelledBy: state.cancelledBy,
        },
      );
      if (!updated)
        throw PlatformError.versionConflict(`Sale ${input.saleId} was modified concurrently.`);
      const events = aggregate.pullDomainEvents().map((event) =>
        salesEvent({
          eventType: 'sales.sale-cancelled',
          organizationId: event.organizationId,
          aggregateId: event.aggregateId,
          aggregateVersion: event.aggregateVersion,
          correlationId: input.correlationId,
          causationId: input.causationId,
          actorId: input.actorId,
          payload: { reason: input.reason },
          occurredAt: event.occurredAt,
        }),
      );
      await this.repository.writeEvents(tx, events);
      const refreshed = await this.repository.findSale(tx, input.organizationId, input.saleId);
      if (!refreshed)
        throw PlatformError.notFound('Sale was not found.', { details: { saleId: input.saleId } });
      const result = toSaleView(refreshed);
      await this.repository.completeIdempotency(
        tx,
        claim.claimId,
        result as unknown as Record<string, unknown>,
      );
      return result;
    });
  }

  async completeSaleAfterPayment(input: CompleteSaleInput): Promise<SaleView> {
    const scope = `SYSTEM:${input.organizationId}:POST:/api/v1/pos/sales/:saleId/complete`;
    const semanticHash = requestHash({
      saleId: input.saleId,
      completionReferenceType: input.completionReferenceType,
      completionReferenceId: input.completionReferenceId,
    });
    const replay = await this.repository.findIdempotency(this.db, input.idempotencyKey, scope);
    if (replay) return this.replaySale(replay, semanticHash);

    return this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotency(
        tx,
        input.idempotencyKey,
        scope,
        semanticHash,
      );
      if (claim.kind === 'existing') return this.replaySale(claim, semanticHash);
      const record = await this.repository.lockSale(tx, input.organizationId, input.saleId);
      if (!record)
        throw PlatformError.notFound('Sale was not found.', { details: { saleId: input.saleId } });
      if (record.sale.status === 'CANCELLED') {
        throw PlatformError.of(
          ERROR_CODES.SALE_INVALID_STATE,
          'Cancelled Sale cannot be completed.',
          { details: { saleId: input.saleId, status: record.sale.status } },
        );
      }
      if (record.sale.status === 'COMPLETED') {
        if (
          record.sale.completionReferenceType &&
          record.sale.completionReferenceId &&
          (record.sale.completionReferenceType !== input.completionReferenceType ||
            record.sale.completionReferenceId !== input.completionReferenceId)
        ) {
          throw PlatformError.idempotencyConflict(
            'Sale was already completed with a different completion reference.',
          );
        }
        const result = toSaleView(record);
        await this.repository.completeIdempotency(
          tx,
          claim.claimId,
          result as unknown as Record<string, unknown>,
        );
        return result;
      }
      await this.inventoryMutations.consumeReservationByIdInTransaction(tx, {
        organizationId: input.organizationId,
        reservationId: record.sale.inventoryReservationId ?? '',
        actorId: input.actorId,
        correlationId: input.correlationId,
      });
      const aggregate = Sale.reconstitute(fromRecord(record));
      aggregate.complete(input.completionReferenceType, input.completionReferenceId);
      const state = aggregate.snapshot;
      const updated = await this.repository.updateSale(
        tx,
        input.organizationId,
        input.saleId,
        record.sale.version,
        {
          status: state.status,
          completedAt: state.completedAt,
          completionReferenceType: state.completionReferenceType,
          completionReferenceId: state.completionReferenceId,
        },
      );
      if (!updated)
        throw PlatformError.versionConflict(`Sale ${input.saleId} was modified concurrently.`);
      const events = aggregate.pullDomainEvents().map((event) =>
        salesEvent({
          eventType: 'sales.sale-completed',
          organizationId: event.organizationId,
          aggregateId: event.aggregateId,
          aggregateVersion: event.aggregateVersion,
          correlationId: input.correlationId,
          causationId: input.causationId,
          actorId: input.actorId,
          payload: {
            completionReferenceType: input.completionReferenceType,
            completionReferenceId: input.completionReferenceId,
          },
          occurredAt: event.occurredAt,
        }),
      );
      await this.repository.writeEvents(tx, events);
      const refreshed = await this.repository.findSale(tx, input.organizationId, input.saleId);
      if (!refreshed)
        throw PlatformError.notFound('Sale was not found.', { details: { saleId: input.saleId } });
      const result = toSaleView(refreshed);
      await this.repository.completeIdempotency(
        tx,
        claim.claimId,
        result as unknown as Record<string, unknown>,
      );
      return result;
    });
  }

  private async obtainReservation(
    tx: Parameters<InventoryMutationContracts['createCartReservationInTransaction']>[0],
    {
      cart,
      lineSnapshots,
      input,
      saleId,
    }: {
      cart: CartCheckoutView;
      lineSnapshots: LineSnapshot[];
      input: CreateSaleInput;
      saleId: string;
    },
  ): Promise<ReservationBinding> {
    if (cart.hold?.inventoryReservationId) {
      if (input.warehouseId && input.warehouseId !== cart.hold.warehouseId) {
        throw PlatformError.validationFailed(
          'warehouseId conflicts with the active held reservation warehouse.',
          {
            details: {
              warehouseId: input.warehouseId,
              reservationWarehouseId: cart.hold.warehouseId,
            },
          },
        );
      }
      try {
        return await this.inventoryMutations.rebindReservationToSaleInTransaction(tx, {
          organizationId: input.organizationId,
          reservationId: cart.hold.inventoryReservationId,
          saleReferenceId: saleId,
          cartVersion: input.cartVersion,
          warehouseId: cart.hold.warehouseId,
          branchId: cart.branchId,
          actorId: input.actorId,
          correlationId: input.correlationId,
          causationId: input.causationId,
        });
      } catch (error: unknown) {
        if (
          !isErrorCode(error, ERROR_CODES.RESERVATION_EXPIRED) &&
          !isErrorCode(error, ERROR_CODES.RESERVATION_NOT_AVAILABLE)
        )
          throw error;
        if (!input.warehouseId) throw error;
      }
    }
    if (!input.warehouseId) {
      throw PlatformError.validationFailed(
        'warehouseId is required when checkout cannot reuse a valid held reservation.',
        { details: { field: 'warehouseId' } },
      );
    }
    const created = await this.inventoryMutations.createCartReservationInTransaction(tx, {
      organizationId: input.organizationId,
      branchId: cart.branchId,
      warehouseId: input.warehouseId,
      referenceType: 'PENDING_SALE',
      referenceId: saleId,
      cartVersion: input.cartVersion,
      demands: lineSnapshots.map((line) => ({
        variantId: line.variant.id,
        quantity: line.baseQuantity,
      })),
      idempotencyKey: input.idempotencyKey,
      requestHash: requestHash({
        warehouseId: input.warehouseId,
        demands: lineSnapshots.map((line) => ({
          variantId: line.variant.id,
          quantity: line.baseQuantity,
        })),
      }),
      correlationId: input.correlationId,
      causationId: input.causationId,
      actorId: input.actorId,
    });
    if (created.kind !== 'ACTIVE') {
      throw PlatformError.of(
        ERROR_CODES.INVENTORY_INSUFFICIENT,
        'Inventory reservation could not be established atomically.',
        { details: { shortages: created.shortages } },
      );
    }
    return {
      reservationId: created.reservation.reservationId,
      warehouseId: created.reservation.warehouseId,
      status: 'ACTIVE' as const,
      referenceType: 'PENDING_SALE' as const,
      referenceId: saleId,
    };
  }

  private async requireSale(organizationId: string, saleId: string): Promise<SaleView> {
    const sale = await this.getSale(organizationId, saleId);
    if (!sale) throw PlatformError.notFound('Sale was not found.', { details: { saleId } });
    return sale;
  }

  private replaySale(
    replay: { requestHash?: string; status?: string; responseJson?: unknown },
    requestHashValue: string,
  ): SaleView {
    if (replay.requestHash !== requestHashValue) {
      throw PlatformError.idempotencyConflict(
        'Idempotency-Key was used with a different Sale request.',
      );
    }
    if (replay.status === 'COMPLETED' && replay.responseJson)
      return replay.responseJson as unknown as SaleView;
    throw PlatformError.idempotencyConflict('Sale mutation is already in progress.');
  }
}

function fromRecord(record: SaleRecord): SaleState {
  return {
    id: record.sale.id,
    organizationId: record.sale.organizationId,
    branchId: record.sale.branchId,
    warehouseId: record.sale.warehouseId,
    cartId: record.sale.cartId,
    cartVersion: record.sale.cartVersion,
    customerId: record.sale.customerId,
    customerType: record.sale.customerType,
    customerDisplayName: record.sale.customerDisplayName,
    customerCode: record.sale.customerCode,
    operatorId: record.sale.operatorId,
    deviceId: record.sale.deviceId,
    saleNumber: record.sale.saleNumber,
    status: record.sale.status,
    priceType: record.sale.priceType,
    currency: record.sale.currency,
    subtotal: record.sale.subtotal,
    discountTotal: record.sale.discountTotal,
    taxTotal: record.sale.taxTotal,
    total: record.sale.total,
    inventoryReservationId: record.sale.inventoryReservationId ?? '',
    inventoryAllocationId: record.sale.inventoryAllocationId,
    completionReferenceType: record.sale.completionReferenceType,
    completionReferenceId: record.sale.completionReferenceId,
    completedAt: record.sale.completedAt,
    cancelledAt: record.sale.cancelledAt,
    cancellationReason: record.sale.cancellationReason,
    cancelledBy: record.sale.cancelledBy,
    correlationId: record.sale.correlationId,
    causationId: record.sale.causationId,
    version: record.sale.version,
    items: record.items.map(toSaleItemState),
  };
}

function toSaleView(record: SaleRecord): SaleView {
  return {
    id: record.sale.id,
    organizationId: record.sale.organizationId,
    branchId: record.sale.branchId,
    warehouseId: record.sale.warehouseId,
    cartId: record.sale.cartId,
    cartVersion: record.sale.cartVersion,
    saleNumber: record.sale.saleNumber,
    status: record.sale.status,
    customerId: record.sale.customerId,
    operatorId: record.sale.operatorId,
    deviceId: record.sale.deviceId,
    priceType: record.sale.priceType,
    currency: record.sale.currency,
    subtotal: record.sale.subtotal,
    discountTotal: record.sale.discountTotal,
    taxTotal: record.sale.taxTotal,
    total: record.sale.total,
    inventoryReservationId: record.sale.inventoryReservationId ?? '',
    completedAt: serializeTimestamp(record.sale.completedAt),
    cancelledAt: serializeTimestamp(record.sale.cancelledAt),
    cancellationReason: record.sale.cancellationReason,
    createdAt: record.sale.createdAt.toISOString(),
    updatedAt: record.sale.updatedAt.toISOString(),
    version: record.sale.version,
    items: record.items.map((item) => ({
      id: item.id,
      variantId: item.variantId,
      productId: item.productId,
      snapshotLabel: item.snapshotLabel,
      sku: item.sku,
      barcode: item.barcode,
      unitId: item.unitId,
      baseUnitId: item.baseUnitId,
      quantity: item.quantity,
      baseQuantity: item.baseQuantity,
      unitPrice: item.unitPrice,
      lineSubtotal: item.lineSubtotal,
      discountTotal: item.discountTotal,
      taxTotal: item.taxTotal,
      lineTotal: item.lineTotal,
      currency: item.currency,
      priceType: item.priceType,
      pricingSource: item.pricingSource,
    })),
  };
}

function toSaleInsert(state: SaleState): Omit<SaleRow, 'createdAt' | 'updatedAt'> {
  return {
    id: state.id,
    organizationId: state.organizationId,
    branchId: state.branchId,
    warehouseId: state.warehouseId,
    cartId: state.cartId,
    cartVersion: state.cartVersion,
    customerId: state.customerId,
    customerType: state.customerType,
    customerDisplayName: state.customerDisplayName,
    customerCode: state.customerCode,
    operatorId: state.operatorId,
    deviceId: state.deviceId,
    saleNumber: state.saleNumber,
    status: state.status,
    priceType: state.priceType,
    currency: state.currency,
    subtotal: state.subtotal,
    discountTotal: state.discountTotal,
    taxTotal: state.taxTotal,
    total: state.total,
    inventoryReservationId: state.inventoryReservationId,
    inventoryAllocationId: state.inventoryAllocationId,
    completionReferenceType: state.completionReferenceType,
    completionReferenceId: state.completionReferenceId,
    completedAt: state.completedAt,
    cancelledAt: state.cancelledAt,
    cancellationReason: state.cancellationReason,
    cancelledBy: state.cancelledBy,
    correlationId: state.correlationId,
    causationId: state.causationId,
    version: state.version,
  };
}

function toSaleItemInserts(
  organizationId: string,
  saleId: string,
  items: readonly SaleItemState[],
): Array<Omit<SaleItemRow, 'createdAt' | 'updatedAt'>> {
  return items.map((item) => ({
    id: item.id,
    organizationId,
    saleId,
    cartItemId: item.cartItemId,
    productId: item.productId,
    variantId: item.variantId,
    productName: item.productName,
    variantName: item.variantName,
    snapshotLabel: item.snapshotLabel,
    sku: item.sku,
    barcode: item.barcode,
    unitId: item.unitId,
    baseUnitId: item.baseUnitId,
    quantity: item.quantity,
    baseQuantity: item.baseQuantity,
    unitPrice: item.unitPrice,
    lineSubtotal: item.lineSubtotal,
    discountTotal: item.discountTotal,
    taxTotal: item.taxTotal,
    lineTotal: item.lineTotal,
    currency: item.currency,
    priceType: item.priceType,
    pricingSource: item.pricingSource,
    pricingReference: item.pricingReference,
  }));
}

function toSaleItemState(item: SaleItemRow): SaleItemState {
  return {
    id: item.id,
    cartItemId: item.cartItemId,
    productId: item.productId,
    variantId: item.variantId,
    productName: item.productName,
    variantName: item.variantName,
    snapshotLabel: item.snapshotLabel,
    sku: item.sku,
    barcode: item.barcode,
    unitId: item.unitId,
    baseUnitId: item.baseUnitId,
    quantity: item.quantity,
    baseQuantity: item.baseQuantity,
    unitPrice: item.unitPrice,
    lineSubtotal: item.lineSubtotal,
    discountTotal: item.discountTotal,
    taxTotal: item.taxTotal,
    lineTotal: item.lineTotal,
    currency: item.currency,
    priceType: item.priceType,
    pricingSource: item.pricingSource,
    pricingReference: item.pricingReference,
  };
}

function isErrorCode(error: unknown, code: string): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function toEight(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(8, '0').slice(0, 8)}`;
}

function multiply(left: string, right: string): string {
  const scale = 100000000n;
  const a = scaled(left);
  const b = scaled(right);
  return formatted((a * b) / scale);
}

function add(left: string, right: string): string {
  return formatted(scaled(left) + scaled(right));
}

function scaled(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole || '0') * 100000000n + BigInt(fraction.padEnd(8, '0').slice(0, 8));
}

function formatted(value: bigint): string {
  return `${value / 100000000n}.${(value % 100000000n).toString().padStart(8, '0')}`;
}

function serializeTimestamp(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}
