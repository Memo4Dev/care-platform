import { describe, it, expect } from 'vitest';

import { mapPersistenceError } from './pricing.repository';

describe('PricingRepository', () => {
  describe('mapPersistenceError', () => {
    it('returns the original error when it is not a PG unique violation', () => {
      const error = new Error('connection refused');
      const result = mapPersistenceError(error, {
        action: 'insert',
        table: 'pricing.price_books',
        organizationId: 'org-1',
      });
      expect(result).toBe(error);
    });

    it('returns the original error when code is not 23505', () => {
      const error = { code: '23503', constraint: 'some_fk' };
      const result = mapPersistenceError(error, {
        action: 'insert',
        table: 'pricing.price_books',
        organizationId: 'org-1',
      });
      expect(result).toBe(error);
    });

    it('returns the original error when constraint is not a string', () => {
      const error = { code: '23505', constraint: 123 };
      const result = mapPersistenceError(error, {
        action: 'insert',
        table: 'pricing.price_books',
        organizationId: 'org-1',
      });
      expect(result).toBe(error);
    });

    it('returns the original error when error is null', () => {
      const result = mapPersistenceError(null, {
        action: 'insert',
        table: 'pricing.price_books',
        organizationId: 'org-1',
      });
      expect(result).toBe(null);
    });

    it('maps price_books_org_name_unique to VALIDATION_FAILED with field "name"', () => {
      const error = { code: '23505', constraint: 'price_books_org_name_unique' };
      const result = mapPersistenceError(error, {
        action: 'insert',
        table: 'pricing.price_books',
        organizationId: 'org-1',
        resourceId: 'pb-1',
      });

      expect(result).toMatchObject({
        details: {
          constraint: 'price_books_org_name_unique',
          field: 'name',
          table: 'pricing.price_books',
          organizationId: 'org-1',
          resourceId: 'pb-1',
        },
      });
    });

    it('maps coupons_org_code_unique to VALIDATION_FAILED with field "code"', () => {
      const error = { code: '23505', constraint: 'coupons_org_code_unique' };
      const result = mapPersistenceError(error, {
        action: 'insert',
        table: 'pricing.coupons',
        organizationId: 'org-2',
      });

      expect(result).toMatchObject({
        details: {
          constraint: 'coupons_org_code_unique',
          field: 'code',
          table: 'pricing.coupons',
          organizationId: 'org-2',
        },
      });
    });

    it('maps promotions_org_name_unique to VALIDATION_FAILED with field "name"', () => {
      const error = { code: '23505', constraint: 'promotions_org_name_unique' };
      const result = mapPersistenceError(error, {
        action: 'insert',
        table: 'pricing.promotions',
        organizationId: 'org-3',
      });

      expect(result).toMatchObject({
        details: {
          constraint: 'promotions_org_name_unique',
          field: 'name',
          table: 'pricing.promotions',
          organizationId: 'org-3',
        },
      });
    });

    it('maps unknown constraints to field "constraint"', () => {
      const error = { code: '23505', constraint: 'some_unknown_constraint' };
      const result = mapPersistenceError(error, {
        action: 'update',
        table: 'pricing.price_entries',
        organizationId: 'org-4',
      });

      expect(result).toMatchObject({
        details: {
          constraint: 'some_unknown_constraint',
          field: 'constraint',
          table: 'pricing.price_entries',
          organizationId: 'org-4',
        },
      });
    });

    it('omits resourceId when not provided', () => {
      const error = { code: '23505', constraint: 'price_books_org_name_unique' };
      const result = mapPersistenceError(error, {
        action: 'insert',
        table: 'pricing.price_books',
        organizationId: 'org-1',
      });

      expect(result).toMatchObject({
        details: expect.objectContaining({
          organizationId: 'org-1',
        }),
      });
      expect((result as { details: Record<string, unknown> }).details).not.toHaveProperty(
        'resourceId',
      );
    });
  });
});
