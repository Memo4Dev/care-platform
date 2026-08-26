import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import { Variant } from './variant';

const ORG_ID = '0198a000-0000-7000-8000-000000000001';
const PRODUCT_ID = '0198a000-0000-7000-8000-000000000010';
const VARIANT_ID = '0198a000-0000-7000-8000-0000000000a1';
const UNIT_ID = '0198a000-0000-7000-8000-0000000000b1';

describe('Variant', () => {
  describe('AddVariant', () => {
    it('given a valid input when creating then variant starts in DRAFT with the correct baseUnitId', () => {
      const variant = Variant.create({
        id: VARIANT_ID,
        organizationId: ORG_ID,
        productId: PRODUCT_ID,
        name: '500mg Strip',
        sku: 'PAR-500-STR',
        baseUnitId: UNIT_ID,
      });

      expect(variant.id).toBe(VARIANT_ID);
      expect(variant.productId).toBe(PRODUCT_ID);
      expect(variant.name).toBe('500mg Strip');
      expect(variant.sku).toBe('PAR-500-STR');
      expect(variant.baseUnitId).toBe(UNIT_ID);
      expect(variant.status).toBe('DRAFT');
      expect(variant.isActive).toBe(true);
      expect(variant.version).toBe(1);
      expect(variant.expectedVersion).toBe(0);
    });

    it('given an empty name when creating then VALIDATION_FAILED is raised', () => {
      let error: unknown;
      try {
        Variant.create({
          id: VARIANT_ID,
          organizationId: ORG_ID,
          productId: PRODUCT_ID,
          name: '   ',
          sku: 'PAR-500-STR',
          baseUnitId: UNIT_ID,
        });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given an empty baseUnitId when creating then VALIDATION_FAILED is raised', () => {
      let error: unknown;
      try {
        Variant.create({
          id: VARIANT_ID,
          organizationId: ORG_ID,
          productId: PRODUCT_ID,
          name: 'Valid Name',
          sku: 'PAR-500-STR',
          baseUnitId: '   ',
        });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });

  describe('UpdateVariant', () => {
    it('given an existing variant when updating name and sku then fields change', () => {
      const variant = Variant.create({
        id: VARIANT_ID,
        organizationId: ORG_ID,
        productId: PRODUCT_ID,
        name: 'Old Name',
        sku: 'OLD-SKU',
        baseUnitId: UNIT_ID,
      });

      variant.update({ name: 'New Name', sku: 'NEW-SKU' });

      expect(variant.name).toBe('New Name');
      expect(variant.sku).toBe('NEW-SKU');
    });

    it('given an existing variant when updating categoryId then categoryId changes', () => {
      const variant = Variant.create({
        id: VARIANT_ID,
        organizationId: ORG_ID,
        productId: PRODUCT_ID,
        name: 'Variant',
        sku: 'SKU',
        baseUnitId: UNIT_ID,
      });

      variant.update({ categoryId: '0198a000-0000-7000-8000-00000000ffff' });

      expect(variant.categoryId).toBe('0198a000-0000-7000-8000-00000000ffff');
    });
  });

  describe('ActivateVariant / DiscontinueVariant transitions', () => {
    it('given a DRAFT variant when activating then status flips to ACTIVE', () => {
      const variant = Variant.create({
        id: VARIANT_ID,
        organizationId: ORG_ID,
        productId: PRODUCT_ID,
        name: 'Variant',
        sku: 'SKU',
        baseUnitId: UNIT_ID,
      });

      variant.activate();

      expect(variant.status).toBe('ACTIVE');
    });

    it('given an ACTIVE variant when discontinuing then status flips to DISCONTINUED', () => {
      const variant = Variant.create({
        id: VARIANT_ID,
        organizationId: ORG_ID,
        productId: PRODUCT_ID,
        name: 'Variant',
        sku: 'SKU',
        baseUnitId: UNIT_ID,
      });
      variant.activate();

      variant.discontinue();

      expect(variant.status).toBe('DISCONTINUED');
    });

    it('given an already-ACTIVE variant when activating again then OPERATION_NOT_ALLOWED', () => {
      const variant = Variant.create({
        id: VARIANT_ID,
        organizationId: ORG_ID,
        productId: PRODUCT_ID,
        name: 'Variant',
        sku: 'SKU',
        baseUnitId: UNIT_ID,
      });
      variant.activate();

      let error: unknown;
      try {
        variant.activate();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
      expect(variant.status).toBe('ACTIVE');
    });

    it('given a DISCONTINUED variant when discontinuing again then OPERATION_NOT_ALLOWED', () => {
      const variant = Variant.create({
        id: VARIANT_ID,
        organizationId: ORG_ID,
        productId: PRODUCT_ID,
        name: 'Variant',
        sku: 'SKU',
        baseUnitId: UNIT_ID,
      });
      variant.discontinue();

      let error: unknown;
      try {
        variant.discontinue();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
      expect(variant.status).toBe('DISCONTINUED');
    });

    it('given a DISCONTINUED variant when activating then OPERATION_NOT_ALLOWED — discontinuation is terminal', () => {
      const variant = Variant.create({
        id: VARIANT_ID,
        organizationId: ORG_ID,
        productId: PRODUCT_ID,
        name: 'Variant',
        sku: 'SKU',
        baseUnitId: UNIT_ID,
      });
      variant.discontinue();

      let error: unknown;
      try {
        variant.activate();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
      expect(variant.status).toBe('DISCONTINUED');
    });
  });

  describe('reconstitution', () => {
    it('given persisted state when reconstituting then version matches and no events are emitted', () => {
      const variant = Variant.reconstitute({
        id: VARIANT_ID,
        organizationId: ORG_ID,
        productId: PRODUCT_ID,
        name: 'Variant',
        sku: 'SKU',
        barcode: '1234567890',
        baseUnitId: UNIT_ID,
        categoryId: null,
        isActive: true,
        status: 'ACTIVE',
        version: 5,
      });

      expect(variant.id).toBe(VARIANT_ID);
      expect(variant.status).toBe('ACTIVE');
      expect(variant.version).toBe(5);
      expect(variant.expectedVersion).toBe(5);
      expect(variant.hasPendingChanges).toBe(false);
    });
  });
});
