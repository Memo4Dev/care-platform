import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import {
  validateAllocationTransition,
  validateAvailableConstraint,
  validateFIFOConsumption,
  validateNonNegativeQuantity,
  validateReservationTransition,
  validateTransferState,
} from './invariants';

describe('Invariants', () => {
  // =========================================================================
  // validateNonNegativeQuantity
  // =========================================================================
  describe('validateNonNegativeQuantity', () => {
    it('given a positive value then ok', () => {
      expect(() => validateNonNegativeQuantity(10, 'qty')).not.toThrow();
    });

    it('given zero then ok', () => {
      expect(() => validateNonNegativeQuantity(0, 'qty')).not.toThrow();
    });

    it('given a negative value then VALIDATION_FAILED error', () => {
      let error: unknown;
      try {
        validateNonNegativeQuantity(-1, 'qty');
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given NaN then VALIDATION_FAILED error', () => {
      let error: unknown;
      try {
        validateNonNegativeQuantity(NaN, 'qty');
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });

  // =========================================================================
  // validateAvailableConstraint
  // =========================================================================
  describe('validateAvailableConstraint', () => {
    it('given valid values then ok', () => {
      expect(() => validateAvailableConstraint(10, 3, 2)).not.toThrow();
    });

    it('given reserved+allocated=onHand then ok (boundary)', () => {
      expect(() => validateAvailableConstraint(10, 5, 5)).not.toThrow();
    });

    it('given all zeros then ok', () => {
      expect(() => validateAvailableConstraint(0, 0, 0)).not.toThrow();
    });

    it('given reserved+allocated > onHand then INVENTORY_INSUFFICIENT error', () => {
      let error: unknown;
      try {
        validateAvailableConstraint(10, 6, 5);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.INVENTORY_INSUFFICIENT);
    });

    it('given negative onHand then VALIDATION_FAILED error', () => {
      let error: unknown;
      try {
        validateAvailableConstraint(-1, 0, 0);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given negative reserved then VALIDATION_FAILED error', () => {
      let error: unknown;
      try {
        validateAvailableConstraint(10, -1, 0);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given negative allocated then VALIDATION_FAILED error', () => {
      let error: unknown;
      try {
        validateAvailableConstraint(10, 0, -1);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });

  // =========================================================================
  // validateTransferState
  // =========================================================================
  describe('validateTransferState', () => {
    it('given DRAFT when dispatching then ok', () => {
      expect(() => validateTransferState('DRAFT', 'DISPATCHED')).not.toThrow();
    });

    it('given DRAFT when cancelling then ok', () => {
      expect(() => validateTransferState('DRAFT', 'CANCELLED')).not.toThrow();
    });

    it('given DISPATCHED when marking in transit then ok', () => {
      expect(() => validateTransferState('DISPATCHED', 'IN_TRANSIT')).not.toThrow();
    });

    it('given DISPATCHED when cancelling then ok', () => {
      expect(() => validateTransferState('DISPATCHED', 'CANCELLED')).not.toThrow();
    });

    it('given IN_TRANSIT when receiving then ok', () => {
      expect(() => validateTransferState('IN_TRANSIT', 'RECEIVED')).not.toThrow();
    });

    it('given IN_TRANSIT when cancelling then TRANSFER_INVALID_STATE error', () => {
      let error: unknown;
      try {
        validateTransferState('IN_TRANSIT', 'CANCELLED');
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.TRANSFER_INVALID_STATE);
    });

    it('given RECEIVED when dispatching then TRANSFER_INVALID_STATE error', () => {
      let error: unknown;
      try {
        validateTransferState('RECEIVED', 'DISPATCHED');
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.TRANSFER_INVALID_STATE);
    });

    it('given CANCELLED when dispatching then TRANSFER_INVALID_STATE error', () => {
      let error: unknown;
      try {
        validateTransferState('CANCELLED', 'DISPATCHED');
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.TRANSFER_INVALID_STATE);
    });

    it('given unknown status then TRANSFER_INVALID_STATE error', () => {
      let error: unknown;
      try {
        validateTransferState('UNKNOWN', 'DISPATCHED');
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.TRANSFER_INVALID_STATE);
    });
  });

  // =========================================================================
  // validateReservationTransition
  // =========================================================================
  describe('validateReservationTransition', () => {
    it('given ACTIVE when consuming then ok', () => {
      expect(() => validateReservationTransition('ACTIVE', 'CONSUMED')).not.toThrow();
    });

    it('given ACTIVE when releasing then ok', () => {
      expect(() => validateReservationTransition('ACTIVE', 'RELEASED')).not.toThrow();
    });

    it('given ACTIVE when expiring then ok', () => {
      expect(() => validateReservationTransition('ACTIVE', 'EXPIRED')).not.toThrow();
    });

    it('given CONSUMED when releasing then OPERATION_NOT_ALLOWED error', () => {
      let error: unknown;
      try {
        validateReservationTransition('CONSUMED', 'RELEASED');
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
    });

    it('given RELEASED when consuming then OPERATION_NOT_ALLOWED error', () => {
      let error: unknown;
      try {
        validateReservationTransition('RELEASED', 'CONSUMED');
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
    });

    it('given EXPIRED when consuming then OPERATION_NOT_ALLOWED error', () => {
      let error: unknown;
      try {
        validateReservationTransition('EXPIRED', 'CONSUMED');
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
    });
  });

  // =========================================================================
  // validateAllocationTransition
  // =========================================================================
  describe('validateAllocationTransition', () => {
    it('given ACTIVE when consuming then ok', () => {
      expect(() => validateAllocationTransition('ACTIVE', 'CONSUMED')).not.toThrow();
    });

    it('given ACTIVE when releasing then ok', () => {
      expect(() => validateAllocationTransition('ACTIVE', 'RELEASED')).not.toThrow();
    });

    it('given ACTIVE when expiring then ok', () => {
      expect(() => validateAllocationTransition('ACTIVE', 'EXPIRED')).not.toThrow();
    });

    it('given CONSUMED when releasing then OPERATION_NOT_ALLOWED error', () => {
      let error: unknown;
      try {
        validateAllocationTransition('CONSUMED', 'RELEASED');
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
    });

    it('given RELEASED when consuming then OPERATION_NOT_ALLOWED error', () => {
      let error: unknown;
      try {
        validateAllocationTransition('RELEASED', 'CONSUMED');
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
    });

    it('given EXPIRED when consuming then OPERATION_NOT_ALLOWED error', () => {
      let error: unknown;
      try {
        validateAllocationTransition('EXPIRED', 'CONSUMED');
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
    });
  });

  // =========================================================================
  // validateFIFOConsumption
  // =========================================================================
  describe('validateFIFOConsumption', () => {
    it('given enough layers then ok', () => {
      const layers = [
        { remainingQuantity: 30 },
        { remainingQuantity: 20 },
        { remainingQuantity: 10 },
      ];

      expect(() => validateFIFOConsumption(50, layers)).not.toThrow();
    });

    it('given exact total then ok', () => {
      const layers = [{ remainingQuantity: 25 }, { remainingQuantity: 25 }];

      expect(() => validateFIFOConsumption(50, layers)).not.toThrow();
    });

    it('given zero quantity then ok even with no layers', () => {
      expect(() => validateFIFOConsumption(0, [])).not.toThrow();
    });

    it('given insufficient layers then INVENTORY_INSUFFICIENT error', () => {
      const layers = [{ remainingQuantity: 10 }, { remainingQuantity: 5 }];

      let error: unknown;
      try {
        validateFIFOConsumption(20, layers);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.INVENTORY_INSUFFICIENT);
    });

    it('given empty layers and positive quantity then INVENTORY_INSUFFICIENT error', () => {
      let error: unknown;
      try {
        validateFIFOConsumption(5, []);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.INVENTORY_INSUFFICIENT);
    });

    it('given negative quantity then VALIDATION_FAILED error', () => {
      let error: unknown;
      try {
        validateFIFOConsumption(-1, [{ remainingQuantity: 10 }]);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });
});
