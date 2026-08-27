import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import {
  calculateLandedCost,
  validateGRStatusTransition,
  validateNonNegativeQuantity,
  validateOverReceiptPolicy,
  validatePOStatusTransition,
  validatePositiveQuantity,
  validateReceiptCompleteness,
} from './invariants';

describe('Purchasing Invariants', () => {
  // =========================================================================
  // validatePositiveQuantity
  // =========================================================================
  describe('validatePositiveQuantity', () => {
    it('given zero when validating then throws', () => {
      let error: unknown;
      try {
        validatePositiveQuantity(0, 'qty');
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given negative when validating then throws', () => {
      let error: unknown;
      try {
        validatePositiveQuantity(-5, 'qty');
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given positive when validating then does not throw', () => {
      expect(() => validatePositiveQuantity(10, 'qty')).not.toThrow();
    });

    it('given NaN when validating then throws', () => {
      let error: unknown;
      try {
        validatePositiveQuantity(NaN, 'qty');
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });

  // =========================================================================
  // validateReceiptCompleteness
  // =========================================================================
  describe('validateReceiptCompleteness', () => {
    it('given matching quantities when validating then does not throw', () => {
      expect(() => validateReceiptCompleteness(10, 8, 2)).not.toThrow();
    });

    it('given all received accepted when validating then does not throw', () => {
      expect(() => validateReceiptCompleteness(10, 10, 0)).not.toThrow();
    });

    it('given mismatched quantities when validating then throws', () => {
      let error: unknown;
      try {
        validateReceiptCompleteness(10, 8, 0); // 8 + 0 ≠ 10
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });

  // =========================================================================
  // validatePOStatusTransition
  // =========================================================================
  describe('validatePOStatusTransition', () => {
    it('given DRAFT→SUBMITTED when validating then does not throw', () => {
      expect(() => validatePOStatusTransition('DRAFT', 'SUBMITTED')).not.toThrow();
    });

    it('given DRAFT→APPROVED when validating then throws', () => {
      let error: unknown;
      try {
        validatePOStatusTransition('DRAFT', 'APPROVED');
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
    });

    it('given SUBMITTED→APPROVED when validating then does not throw', () => {
      expect(() => validatePOStatusTransition('SUBMITTED', 'APPROVED')).not.toThrow();
    });

    it('given SUBMITTED→REJECTED when validating then does not throw', () => {
      expect(() => validatePOStatusTransition('SUBMITTED', 'REJECTED')).not.toThrow();
    });

    it('given APPROVED→SENT when validating then does not throw', () => {
      expect(() => validatePOStatusTransition('APPROVED', 'SENT')).not.toThrow();
    });

    it('given SENT→PARTIALLY_RECEIVED when validating then does not throw', () => {
      expect(() => validatePOStatusTransition('SENT', 'PARTIALLY_RECEIVED')).not.toThrow();
    });

    it('given SENT→RECEIVED when validating then does not throw', () => {
      expect(() => validatePOStatusTransition('SENT', 'RECEIVED')).not.toThrow();
    });

    it('given RECEIVED→DRAFT when validating then throws', () => {
      let error: unknown;
      try {
        validatePOStatusTransition('RECEIVED', 'DRAFT');
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
    });

    it('given DRAFT→CANCELLED when validating then does not throw', () => {
      expect(() => validatePOStatusTransition('DRAFT', 'CANCELLED')).not.toThrow();
    });

    it('given SUBMITTED→CANCELLED when validating then does not throw', () => {
      expect(() => validatePOStatusTransition('SUBMITTED', 'CANCELLED')).not.toThrow();
    });

    it('given SENT→CANCELLED when validating then does not throw', () => {
      expect(() => validatePOStatusTransition('SENT', 'CANCELLED')).not.toThrow();
    });

    it('given CANCELLED→SUBMITTED when validating then throws', () => {
      let error: unknown;
      try {
        validatePOStatusTransition('CANCELLED', 'SUBMITTED');
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
    });
  });

  // =========================================================================
  // validateGRStatusTransition
  // =========================================================================
  describe('validateGRStatusTransition', () => {
    it('given PENDING→CONFIRMED when validating then does not throw', () => {
      expect(() => validateGRStatusTransition('PENDING', 'CONFIRMED')).not.toThrow();
    });

    it('given PENDING→CANCELLED when validating then does not throw', () => {
      expect(() => validateGRStatusTransition('PENDING', 'CANCELLED')).not.toThrow();
    });

    it('given CONFIRMED→CANCELLED when validating then throws', () => {
      let error: unknown;
      try {
        validateGRStatusTransition('CONFIRMED', 'CANCELLED');
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
    });

    it('given CANCELLED→CONFIRMED when validating then throws', () => {
      let error: unknown;
      try {
        validateGRStatusTransition('CANCELLED', 'CONFIRMED');
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
    });
  });

  // =========================================================================
  // validateOverReceiptPolicy
  // =========================================================================
  describe('validateOverReceiptPolicy', () => {
    it('given over receipt not allowed and received > ordered then throws POLICY_VIOLATION', () => {
      let error: unknown;
      try {
        validateOverReceiptPolicy(10, 12, { allowOverReceipt: false });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.POLICY_VIOLATION);
    });

    it('given over receipt not allowed and received <= ordered then does not throw', () => {
      expect(() => validateOverReceiptPolicy(10, 10, { allowOverReceipt: false })).not.toThrow();
      expect(() => validateOverReceiptPolicy(10, 8, { allowOverReceipt: false })).not.toThrow();
    });

    it('given over receipt allowed and received <= ordered then does not throw', () => {
      expect(() => validateOverReceiptPolicy(10, 12, { allowOverReceipt: true })).not.toThrow();
    });

    it('given over receipt allowed with max percent and within limit then does not throw', () => {
      // 10 ordered, 20% max → cap = 12. Received 11 is within limit
      expect(() => validateOverReceiptPolicy(10, 11, { allowOverReceipt: true, maxOverReceiptPercent: 20 })).not.toThrow();
    });

    it('given over receipt allowed with max percent and exceeds limit then throws', () => {
      // 10 ordered, 20% max → cap = 12. Received 13 exceeds cap
      let error: unknown;
      try {
        validateOverReceiptPolicy(10, 13, { allowOverReceipt: true, maxOverReceiptPercent: 20 });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.POLICY_VIOLATION);
    });

    it('given over receipt allowed with exact cap then does not throw', () => {
      // 10 ordered, 50% max → cap = 15. Received 15 is exactly at cap
      expect(() => validateOverReceiptPolicy(10, 15, { allowOverReceipt: true, maxOverReceiptPercent: 50 })).not.toThrow();
    });
  });

  // =========================================================================
  // calculateLandedCost
  // =========================================================================
  describe('calculateLandedCost', () => {
    it('given no additional costs then landed cost equals unit cost', () => {
      const result = calculateLandedCost(5.0, [], 10);
      expect(result).toBe(5.0);
    });

    it('given additional costs and qty > 0 then landed cost = unit cost + (total costs / qty)', () => {
      // unitCost=5.0, additionalCosts=[{amount:100}], qty=10 → 5.0 + 100/10 = 15.0
      const result = calculateLandedCost(5.0, [{ amount: 100 }], 10);
      expect(result).toBe(15.0);
    });

    it('given additional costs and qty = 0 then landed cost equals unit cost', () => {
      const result = calculateLandedCost(5.0, [{ amount: 100 }], 0);
      expect(result).toBe(5.0);
    });

    it('given multiple cost types then correctly sums all costs', () => {
      // unitCost=10.0, costs=[{50},{30},{20}], qty=10 → 10.0 + 100/10 = 20.0
      const result = calculateLandedCost(
        10.0,
        [{ amount: 50 }, { amount: 30 }, { amount: 20 }],
        10,
      );
      expect(result).toBe(20.0);
    });

    it('given additional costs that produce fractions then rounds to 4 decimal places', () => {
      // unitCost=5.0, costs=[{amount:7}], qty=3 → 5.0 + 7/3 = 5.0 + 2.3333... = 7.3333
      const result = calculateLandedCost(5.0, [{ amount: 7 }], 3);
      expect(result).toBeCloseTo(7.3333, 4);
    });
  });
});
