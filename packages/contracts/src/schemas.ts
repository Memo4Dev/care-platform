/**
 * Shared zod schemas for scalar DTO fields reused across bounded contexts.
 *
 * Source of truth: `docs/architecture/61-dto-contracts.md`.
 *
 * Rules encoded here:
 * - Identifiers are UUID strings (the platform generates UUIDv7 internally;
 *   the wire contract accepts any valid UUID string form).
 * - Money and quantities are decimal STRINGS, never numbers: JSON floats lose
 *   precision (`61-dto-contracts.md`, e.g. `"amount": "1250.5000"`). A JS
 *   number input is therefore rejected by design.
 * - Timestamps are ISO 8601 in UTC (`Z`) so ordering/comparison is canonical.
 */
import { z } from 'zod';

/** Any platform resource identifier. */
export const uuidSchema = z.uuid();

/** Organization (tenant) identifier. Every read/write must carry one. */
export const organizationIdSchema = uuidSchema;

/** Branch identifier; branch-scoped actions authorize against it. */
export const branchIdSchema = uuidSchema;

/** Warehouse identifier used by inventory/purchasing contexts. */
export const warehouseIdSchema = uuidSchema;

/** Integer >= 1 (page sizes, quantities counts, version-free counters). */
export const positiveIntSchema = z.number().int().positive();

/**
 * Decimal amount as a string, e.g. `"1250.5000"`, `"10"`, `"-45.50"`.
 *
 * - Up to 8 fractional digits (covers money numeric(…,4) and quantity
 *   numeric(…,8) columns).
 * - No exponent notation, thousands separators, or bare signs.
 * - Numbers are rejected on purpose: floats must never cross the boundary.
 */
export const moneyAmountSchema = z
  .string()
  .regex(/^-?\d{1,17}(\.\d{1,8})?$/, 'Expected a decimal amount string');

/** ISO 8601 timestamp in UTC, e.g. `2026-08-24T12:30:00Z`. */
export const timestampSchema = z.iso.datetime();
