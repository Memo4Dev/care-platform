import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

import type { Channel, PriceType } from './events';

/**
 * Price quote domain service — resolves the best applicable price for a
 * variant in a given context.
 *
 * Quote resolution logic:
 * 1. Filter to entries matching the requested variantId, unitId, priceType
 *    and channel.
 * 2. Filter to entries that are effective at the given date.
 * 3. Prefer branch-specific entries (branchId === requested branchId) over
 *    org-wide entries (branchId === null).
 * 4. If a branch-specific entry exists, return it with source 'BRANCH'.
 *    Otherwise return the org-wide entry with source 'ORGANIZATIONAL'.
 * 5. If no matching entry exists, throw PRICE_NOT_AVAILABLE.
 *
 * This is NOT an aggregate — it is a pure domain service with no state.
 *
 * This file imports only plain contracts: no NestJS, no Drizzle.
 */

export interface PriceQuoteInput {
  readonly variantId: string;
  readonly unitId: string;
  readonly priceType: PriceType;
  readonly channel: Channel;
  readonly branchId?: string | null;
  readonly effectiveDate: Date;
}

export interface PriceQuote {
  readonly amount: string;
  readonly priceType: PriceType;
  readonly channel: Channel;
  readonly source: 'BRANCH' | 'ORGANIZATIONAL';
}

export interface PriceEntryRecord {
  readonly variantId: string;
  readonly unitId: string;
  readonly priceType: PriceType;
  readonly channel: Channel;
  readonly branchId: string | null;
  readonly amount: string;
  readonly effectiveFrom: Date | null;
  readonly effectiveTo: Date | null;
}

/**
 * Resolve the best applicable price quote for a variant in a given context.
 *
 * @throws PlatformError with PRICE_NOT_AVAILABLE when no matching entry
 *   exists.
 */
export function resolvePriceQuote(
  input: PriceQuoteInput,
  priceEntries: PriceEntryRecord[],
): PriceQuote {
  // Step 1: Filter to matching variant + unit + priceType + channel
  const candidates = priceEntries.filter(
    (entry) =>
      entry.variantId === input.variantId &&
      entry.unitId === input.unitId &&
      entry.priceType === input.priceType &&
      entry.channel === input.channel,
  );

  // Step 2: Filter to entries effective at the requested date
  const effective = candidates.filter((entry) => {
    if (entry.effectiveFrom !== null && input.effectiveDate < entry.effectiveFrom) {
      return false;
    }
    if (entry.effectiveTo !== null && input.effectiveDate >= entry.effectiveTo) {
      return false;
    }
    return true;
  });

  if (effective.length === 0) {
    throw PlatformError.of(
      ERROR_CODES.PRICE_NOT_AVAILABLE,
      `No price available for variant "${input.variantId}" with unit "${input.unitId}", price type "${input.priceType}", channel "${input.channel}".`,
      {
        details: {
          variantId: input.variantId,
          unitId: input.unitId,
          priceType: input.priceType,
          channel: input.channel,
          branchId: input.branchId ?? null,
        },
      },
    );
  }

  // Step 3: Prefer branch-specific over org-wide
  if (input.branchId) {
    const branchEntry = effective.find((entry) => entry.branchId === input.branchId);
    if (branchEntry) {
      return {
        amount: branchEntry.amount,
        priceType: branchEntry.priceType,
        channel: branchEntry.channel,
        source: 'BRANCH',
      };
    }
  }

  // Step 4: Fall back to org-wide
  const orgWide = effective.find((entry) => entry.branchId === null);
  if (orgWide) {
    return {
      amount: orgWide.amount,
      priceType: orgWide.priceType,
      channel: orgWide.channel,
      source: 'ORGANIZATIONAL',
    };
  }

  // All candidates had branchIds but none matched the requested branch
  throw PlatformError.of(
    ERROR_CODES.PRICE_NOT_AVAILABLE,
    `No price available for variant "${input.variantId}" with unit "${input.unitId}", price type "${input.priceType}", channel "${input.channel}".`,
    {
      details: {
        variantId: input.variantId,
        unitId: input.unitId,
        priceType: input.priceType,
        channel: input.channel,
        branchId: input.branchId ?? null,
      },
    },
  );
}
