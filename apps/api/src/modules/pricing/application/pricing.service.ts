import {
  newId,
  type Channel,
  type DatabaseClient,
  type PriceType,
} from '@commerce-platform/database';
import { PlatformError } from '@commerce-platform/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { DATABASE } from '../../database/database.tokens';
import { PriceBook } from '../domain/price-book';
import { PriceEntry } from '../domain/price-entry';
import { Promotion } from '../domain/promotion';
import { Coupon } from '../domain/coupon';
import { type PricingDomainEvent } from '../domain/events';
import { resolvePriceQuote, type PriceQuote } from '../domain/quote';
import type { DbExecutor } from '../infrastructure/db-executor';
import { PricingRepository } from '../infrastructure/pricing.repository';

/**
 * Application service of the Pricing context: one method per domain
 * command (docs/architecture/13-pricing.md), each executed inside a
 * single database transaction that loads the aggregate, applies the
 * command and saves aggregate changes + domain events (transactional outbox).
 *
 * Authentication, authorization and entitlement checks are intentionally NOT
 * part of this service; they arrive with the HTTP/API layer.
 */
@Injectable()
export class PricingService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(PricingRepository) private readonly repository: PricingRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // Price Book commands
  // ---------------------------------------------------------------------------

  async createPriceBook(command: {
    organizationId: string;
    priceBookId?: string;
    name: string;
    description?: string;
    isDefault?: boolean;
  }): Promise<PricingCommandResult> {
    const priceBookId = command.priceBookId ?? newId();
    const aggregate = PriceBook.create({
      id: priceBookId,
      organizationId: command.organizationId,
      name: command.name,
      description: command.description,
      isDefault: command.isDefault,
    });

    return this.db.transaction(async (tx) => {
      // If this is the first price book or marked as default, clear existing defaults
      if (command.isDefault) {
        await this.repository.updateDefaultPriceBooks(tx, command.organizationId, priceBookId);
      }

      const events = aggregate.pullDomainEvents();
      const eventsPersisted = await this.repository.savePriceBook(tx, aggregate, events);
      return toResult('PriceBook', aggregate.id, eventsPersisted);
    });
  }

  async setDefaultPriceBook(command: {
    organizationId: string;
    priceBookId: string;
  }): Promise<PricingCommandResult> {
    return this.db.transaction(async (tx) => {
      const aggregate = await this.repository.findPriceBook(
        tx,
        command.organizationId,
        command.priceBookId,
      );
      if (!aggregate) {
        throw PlatformError.notFound(`Price book ${command.priceBookId} was not found.`, {
          details: { priceBookId: command.priceBookId },
        });
      }

      // Clear all existing defaults in the organization
      await this.repository.updateDefaultPriceBooks(
        tx,
        command.organizationId,
        command.priceBookId,
      );

      aggregate.setDefault();
      const events = aggregate.pullDomainEvents();
      const eventsPersisted = await this.repository.savePriceBook(tx, aggregate, events);
      return toResult('PriceBook', aggregate.id, eventsPersisted);
    });
  }

  async deactivatePriceBook(command: {
    organizationId: string;
    priceBookId: string;
  }): Promise<PricingCommandResult> {
    return this.executeForAggregate(
      command.organizationId,
      (tx) => this.repository.findPriceBook(tx, command.organizationId, command.priceBookId),
      (aggregate) => {
        aggregate.deactivate();
      },
      (tx, aggregate, events) => this.repository.savePriceBook(tx, aggregate, events),
      'PriceBook',
    );
  }

  // ---------------------------------------------------------------------------
  // Price Entry commands
  // ---------------------------------------------------------------------------

  async createPriceEntry(command: {
    organizationId: string;
    entryId?: string;
    priceBookId: string;
    variantId: string;
    unitId: string;
    priceType: PriceType;
    channel: Channel;
    branchId?: string | null;
    amount: string;
    effectiveFrom?: Date | null;
    effectiveTo?: Date | null;
  }): Promise<PricingCommandResult> {
    const entryId = command.entryId ?? newId();
    const aggregate = PriceEntry.create({
      id: entryId,
      organizationId: command.organizationId,
      priceBookId: command.priceBookId,
      variantId: command.variantId,
      unitId: command.unitId,
      priceType: command.priceType,
      channel: command.channel,
      branchId: command.branchId,
      amount: command.amount,
      effectiveFrom: command.effectiveFrom,
      effectiveTo: command.effectiveTo,
    });

    return this.db.transaction(async (tx) => {
      // Validate that the price book exists and belongs to this org
      const priceBook = await this.repository.findPriceBook(
        tx,
        command.organizationId,
        command.priceBookId,
      );
      if (!priceBook) {
        throw PlatformError.notFound(`Price book ${command.priceBookId} was not found.`, {
          details: { priceBookId: command.priceBookId },
        });
      }

      const events = aggregate.pullDomainEvents();
      const eventsPersisted = await this.repository.savePriceEntry(tx, aggregate, events);
      return toResult('PriceEntry', aggregate.id, eventsPersisted);
    });
  }

  async updatePriceEntry(command: {
    organizationId: string;
    entryId: string;
    amount: string;
  }): Promise<PricingCommandResult> {
    return this.executeForAggregate(
      command.organizationId,
      (tx) => this.repository.findPriceEntry(tx, command.organizationId, command.entryId),
      (aggregate) => {
        aggregate.update({ amount: command.amount });
      },
      (tx, aggregate, events) => this.repository.savePriceEntry(tx, aggregate, events),
      'PriceEntry',
    );
  }

  // ---------------------------------------------------------------------------
  // Promotion commands
  // ---------------------------------------------------------------------------

  async createPromotion(command: {
    organizationId: string;
    promotionId?: string;
    name: string;
    type: Promotion['type'];
    target: Promotion['target'];
    value: string;
    minQuantity?: number | null;
    maxQuantity?: number | null;
    startDate?: Date | null;
    endDate?: Date | null;
  }): Promise<PricingCommandResult> {
    const promotionId = command.promotionId ?? newId();
    const aggregate = Promotion.create({
      id: promotionId,
      organizationId: command.organizationId,
      name: command.name,
      type: command.type,
      target: command.target,
      value: command.value,
      minQuantity: command.minQuantity,
      maxQuantity: command.maxQuantity,
      startDate: command.startDate,
      endDate: command.endDate,
    });

    return this.db.transaction(async (tx) => {
      const events = aggregate.pullDomainEvents();
      const eventsPersisted = await this.repository.savePromotion(tx, aggregate, events);
      return toResult('Promotion', aggregate.id, eventsPersisted);
    });
  }

  async deactivatePromotion(command: {
    organizationId: string;
    promotionId: string;
  }): Promise<PricingCommandResult> {
    return this.executeForAggregate(
      command.organizationId,
      (tx) => this.repository.findPromotion(tx, command.organizationId, command.promotionId),
      (aggregate) => {
        aggregate.deactivate();
      },
      (tx, aggregate, events) => this.repository.savePromotion(tx, aggregate, events),
      'Promotion',
    );
  }

  // ---------------------------------------------------------------------------
  // Coupon commands
  // ---------------------------------------------------------------------------

  async createCoupon(command: {
    organizationId: string;
    couponId?: string;
    code: string;
    type: string;
    value: string;
    promotionId: string;
    maxUses?: number | null;
    minOrderAmount?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
  }): Promise<PricingCommandResult> {
    const couponId = command.couponId ?? newId();
    const aggregate = Coupon.create({
      id: couponId,
      organizationId: command.organizationId,
      code: command.code,
      type: command.type,
      value: command.value,
      promotionId: command.promotionId,
      maxUses: command.maxUses,
      minOrderAmount: command.minOrderAmount,
      startDate: command.startDate,
      endDate: command.endDate,
    });

    return this.db.transaction(async (tx) => {
      const events = aggregate.pullDomainEvents();
      const eventsPersisted = await this.repository.saveCoupon(tx, aggregate, events);
      return toResult('Coupon', aggregate.id, eventsPersisted);
    });
  }

  async redeemCoupon(command: {
    organizationId: string;
    couponId: string;
  }): Promise<PricingCommandResult> {
    return this.executeForAggregate(
      command.organizationId,
      (tx) => this.repository.findCoupon(tx, command.organizationId, command.couponId),
      (aggregate) => {
        aggregate.redeem();
      },
      (tx, aggregate, events) => this.repository.saveCoupon(tx, aggregate, events),
      'Coupon',
    );
  }

  async deactivateCoupon(command: {
    organizationId: string;
    couponId: string;
  }): Promise<PricingCommandResult> {
    return this.executeForAggregate(
      command.organizationId,
      (tx) => this.repository.findCoupon(tx, command.organizationId, command.couponId),
      (aggregate) => {
        aggregate.deactivate();
      },
      (tx, aggregate, events) => this.repository.saveCoupon(tx, aggregate, events),
      'Coupon',
    );
  }

  // ---------------------------------------------------------------------------
  // Query: Price Quote Resolution
  // ---------------------------------------------------------------------------

  async resolvePriceQuote(command: {
    organizationId: string;
    variantId: string;
    unitId: string;
    priceType: PriceType;
    channel: Channel;
    branchId?: string | null;
    effectiveDate?: string;
  }): Promise<PriceQuote> {
    const effectiveDate = command.effectiveDate ? new Date(command.effectiveDate) : new Date();

    // Load the default price book for the org
    const defaultBook = await this.repository.findDefaultPriceBook(this.db, command.organizationId);
    if (!defaultBook) {
      throw PlatformError.of(
        'PRICE_NOT_AVAILABLE',
        `No default price book configured for organization.`,
        { details: { organizationId: command.organizationId } },
      );
    }

    // Fetch all active price entries for the variant
    const priceEntries = await this.repository.findActivePriceEntries(
      this.db,
      command.organizationId,
      command.variantId,
      effectiveDate,
    );

    return resolvePriceQuote(
      {
        variantId: command.variantId,
        unitId: command.unitId,
        priceType: command.priceType,
        channel: command.channel,
        branchId: command.branchId,
        effectiveDate,
      },
      priceEntries,
    );
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async executeForAggregate<
    T extends {
      pullDomainEvents(): PricingDomainEvent[];
      markPersisted(): void;
      readonly id: string;
    },
  >(
    organizationId: string,
    load: (tx: DbExecutor) => Promise<T | null>,
    mutate: (aggregate: T) => void,
    save: (tx: DbExecutor, aggregate: T, events: PricingDomainEvent[]) => Promise<number>,
    resourceType: string = 'Resource',
  ): Promise<PricingCommandResult> {
    return this.db.transaction(async (tx) => {
      const aggregate = await load(tx);
      if (!aggregate) {
        throw PlatformError.notFound(`Resource not found in organization ${organizationId}.`, {
          details: { organizationId },
        });
      }
      mutate(aggregate);
      const events = aggregate.pullDomainEvents();
      const eventsPersisted = await save(tx, aggregate, events);
      return toResult(resourceType, aggregate.id, eventsPersisted);
    });
  }
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface PricingCommandResult {
  resourceType: string;
  resourceId: string;
  eventsPersisted: number;
}

function toResult(
  resourceType: string,
  resourceId: string,
  eventsPersisted: number,
): PricingCommandResult {
  return { resourceType, resourceId, eventsPersisted };
}
