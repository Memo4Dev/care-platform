import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import {
  type UnitConversion,
  convert,
  findConversionPath,
  validateConversion,
} from './unit-conversion';

const PIECE_ID = '0198a000-0000-7000-8000-000000000030';
const STRIP_ID = '0198a000-0000-7000-8000-000000000031';
const BOX_ID = '0198a000-0000-7000-8000-000000000032';
const CASE_ID = '0198a000-0000-7000-8000-000000000033';

const STRIP_TO_PIECE: UnitConversion = { fromUnitId: STRIP_ID, toUnitId: PIECE_ID, factor: '10' };
const BOX_TO_STRIP: UnitConversion = { fromUnitId: BOX_ID, toUnitId: STRIP_ID, factor: '12' };
const CASE_TO_BOX: UnitConversion = { fromUnitId: CASE_ID, toUnitId: BOX_ID, factor: '6' };

describe('UnitConversion', () => {
  describe('convert', () => {
    it('given the same unit when converting then quantity is returned unchanged', () => {
      const result = convert(PIECE_ID, PIECE_ID, '100', []);
      expect(result).toBe('100');
    });

    it('given a direct conversion when converting then factor is applied', () => {
      const result = convert(STRIP_ID, PIECE_ID, '5', [STRIP_TO_PIECE]);
      // 5 * 10 = 50
      expect(result).toBe('50');
    });

    it('given a transitive conversion path when converting then the chain is followed', () => {
      // Box -> Strip -> Piece: 1 Box = 12 Strips = 120 Pieces
      const result = convert(BOX_ID, PIECE_ID, '1', [STRIP_TO_PIECE, BOX_TO_STRIP]);
      expect(result).toBe('120');
    });

    it('given a long transitive chain when converting then all factors are multiplied', () => {
      // Case -> Box -> Strip -> Piece: 1 Case = 6 Boxes = 72 Strips = 720 Pieces
      const result = convert(CASE_ID, PIECE_ID, '1', [STRIP_TO_PIECE, BOX_TO_STRIP, CASE_TO_BOX]);
      expect(result).toBe('720');
    });

    it('given no path when converting then INVALID_UNIT_CONVERSION is thrown', () => {
      let error: unknown;
      try {
        convert(PIECE_ID, CASE_ID, '1', []);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.INVALID_UNIT_CONVERSION);
    });

    it('given a reverse conversion path when converting then the reciprocal factor is used', () => {
      // Piece -> Strip: 10 Pieces = 1 Strip (factor 1/10 = 0.1)
      const result = convert(PIECE_ID, STRIP_ID, '10', [STRIP_TO_PIECE]);
      expect(result).toBe('1');
    });
  });

  describe('findConversionPath', () => {
    it('given the same unit when finding path then empty path is returned', () => {
      const path = findConversionPath(PIECE_ID, PIECE_ID, []);
      expect(path).toEqual([]);
    });

    it('given a direct connection when finding path then single step is returned', () => {
      const path = findConversionPath(STRIP_ID, PIECE_ID, [STRIP_TO_PIECE]);
      expect(path).toHaveLength(1);
      expect(path![0]).toEqual(STRIP_TO_PIECE);
    });

    it('given a multi-step path when finding path then the shortest path is returned', () => {
      const path = findConversionPath(BOX_ID, PIECE_ID, [STRIP_TO_PIECE, BOX_TO_STRIP]);
      expect(path).toHaveLength(2);
    });

    it('given no connection when finding path then null is returned', () => {
      const path = findConversionPath(PIECE_ID, CASE_ID, []);
      expect(path).toBeNull();
    });
  });

  describe('validateConversion', () => {
    it('given valid conversions when validating then no errors are returned', () => {
      const errors = validateConversion([STRIP_TO_PIECE, BOX_TO_STRIP]);
      expect(errors).toHaveLength(0);
    });

    it('given a self-referencing conversion when validating then error is returned', () => {
      const errors = validateConversion([
        { fromUnitId: PIECE_ID, toUnitId: PIECE_ID, factor: '1' },
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Self-referencing');
    });

    it('given a zero factor when validating then error is returned', () => {
      const errors = validateConversion([
        { fromUnitId: STRIP_ID, toUnitId: PIECE_ID, factor: '0' },
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('must be positive');
    });

    it('given a negative factor when validating then error is returned', () => {
      const errors = validateConversion([
        { fromUnitId: STRIP_ID, toUnitId: PIECE_ID, factor: '-5' },
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('must be positive');
    });

    it('given duplicate directed conversions when validating then error is returned', () => {
      const errors = validateConversion([
        { fromUnitId: STRIP_ID, toUnitId: PIECE_ID, factor: '10' },
        { fromUnitId: STRIP_ID, toUnitId: PIECE_ID, factor: '10' },
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Duplicate directed');
    });

    it('given multiple errors when validating then all errors are returned', () => {
      const errors = validateConversion([
        { fromUnitId: PIECE_ID, toUnitId: PIECE_ID, factor: '1' },
        { fromUnitId: STRIP_ID, toUnitId: PIECE_ID, factor: '0' },
      ]);
      expect(errors).toHaveLength(2);
    });
  });
});
