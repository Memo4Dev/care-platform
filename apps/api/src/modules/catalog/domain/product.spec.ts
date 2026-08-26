import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import { Product } from './product';

/** Fixed clock so event timestamps are deterministic in assertions. */
const FIXED_NOW = new Date('2026-01-15T10:00:00.000Z');
const clock = (): Date => new Date(FIXED_NOW);

const ORG_ID = '0198a000-0000-7000-8000-000000000001';
const PRODUCT_ID = '0198a000-0000-7000-8000-000000000010';

describe('Product', () => {
  describe('CreateProduct', () => {
    it('given a valid name when creating then status is DRAFT and one ProductCreated event is collected', () => {
      const product = Product.create(
        { id: PRODUCT_ID, organizationId: ORG_ID, name: 'Paracetamol 500mg' },
        { clock },
      );

      expect(product.id).toBe(PRODUCT_ID);
      expect(product.organizationId).toBe(ORG_ID);
      expect(product.name).toBe('Paracetamol 500mg');
      expect(product.description).toBe('');
      expect(product.status).toBe('DRAFT');
      expect(product.version).toBe(1);
      expect(product.expectedVersion).toBe(0);

      const events = product.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'ProductCreated',
        occurredAt: FIXED_NOW,
        organizationId: ORG_ID,
        productId: PRODUCT_ID,
        name: 'Paracetamol 500mg',
        status: 'DRAFT',
      });
    });

    it('given an empty name when creating then VALIDATION_FAILED is raised and nothing is emitted', () => {
      let error: unknown;
      try {
        Product.create({ id: PRODUCT_ID, organizationId: ORG_ID, name: '   ' }, { clock });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given pulled events when pulling again then the aggregate emits each event exactly once', () => {
      const product = Product.create(
        { id: PRODUCT_ID, organizationId: ORG_ID, name: 'Product' },
        { clock },
      );
      expect(product.pullDomainEvents()).toHaveLength(1);
      expect(product.pullDomainEvents()).toHaveLength(0);
    });
  });

  describe('UpdateProduct', () => {
    it('given an existing product when updating name then name changes and ProductUpdated is emitted', () => {
      const product = Product.create(
        { id: PRODUCT_ID, organizationId: ORG_ID, name: 'Old Name' },
        { clock },
      );
      product.pullDomainEvents();

      product.update({ name: 'New Name' });

      expect(product.name).toBe('New Name');
      const events = product.pullDomainEvents();
      expect(events).toEqual([
        {
          type: 'ProductUpdated',
          occurredAt: FIXED_NOW,
          organizationId: ORG_ID,
          productId: PRODUCT_ID,
          name: 'New Name',
        },
      ]);
    });

    it('given an existing product when updating description then description changes', () => {
      const product = Product.create(
        { id: PRODUCT_ID, organizationId: ORG_ID, name: 'Product' },
        { clock },
      );
      product.pullDomainEvents();

      product.update({ description: 'A detailed description' });

      expect(product.description).toBe('A detailed description');
      expect(product.pullDomainEvents()).toHaveLength(1);
    });
  });

  describe('ActivateProduct / DiscontinueProduct transitions', () => {
    it('given a DRAFT product when activating then status flips to ACTIVE and ProductActivated is emitted', () => {
      const product = Product.create(
        { id: PRODUCT_ID, organizationId: ORG_ID, name: 'Product' },
        { clock },
      );
      product.pullDomainEvents();

      product.activate();

      expect(product.status).toBe('ACTIVE');
      const events = product.pullDomainEvents();
      expect(events).toEqual([
        {
          type: 'ProductActivated',
          occurredAt: FIXED_NOW,
          organizationId: ORG_ID,
          productId: PRODUCT_ID,
        },
      ]);
    });

    it('given an ACTIVE product when discontinuing then status flips to DISCONTINUED and ProductDiscontinued is emitted', () => {
      const product = Product.create(
        { id: PRODUCT_ID, organizationId: ORG_ID, name: 'Product' },
        { clock },
      );
      product.activate();
      product.pullDomainEvents();

      product.discontinue();

      expect(product.status).toBe('DISCONTINUED');
      expect(product.pullDomainEvents()).toEqual([
        {
          type: 'ProductDiscontinued',
          occurredAt: FIXED_NOW,
          organizationId: ORG_ID,
          productId: PRODUCT_ID,
        },
      ]);
    });

    it('given an already-ACTIVE product when activating again then OPERATION_NOT_ALLOWED', () => {
      const product = Product.create(
        { id: PRODUCT_ID, organizationId: ORG_ID, name: 'Product' },
        { clock },
      );
      product.activate();
      product.pullDomainEvents();

      let error: unknown;
      try {
        product.activate();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      const platformError = error as { code: string; details?: Record<string, unknown> };
      expect(platformError.code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
      expect(platformError.details).toMatchObject({ productId: PRODUCT_ID, status: 'ACTIVE' });
      expect(product.status).toBe('ACTIVE');
      expect(product.pullDomainEvents()).toHaveLength(0);
    });

    it('given an already-DISCONTINUED product when discontinuing again then OPERATION_NOT_ALLOWED', () => {
      const product = Product.create(
        { id: PRODUCT_ID, organizationId: ORG_ID, name: 'Product' },
        { clock },
      );
      product.discontinue();
      product.pullDomainEvents();

      let error: unknown;
      try {
        product.discontinue();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
      expect(product.status).toBe('DISCONTINUED');
      expect(product.pullDomainEvents()).toHaveLength(0);
    });

    it('given a DISCONTINUED product when activating then OPERATION_NOT_ALLOWED — discontinuation is terminal', () => {
      const product = Product.create(
        { id: PRODUCT_ID, organizationId: ORG_ID, name: 'Product' },
        { clock },
      );
      product.discontinue();

      let error: unknown;
      try {
        product.activate();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
      expect(product.status).toBe('DISCONTINUED');
    });
  });

  describe('change journaling', () => {
    it('given a fresh aggregate when collecting changes then root row is marked new', () => {
      const product = Product.create(
        { id: PRODUCT_ID, organizationId: ORG_ID, name: 'Product' },
        { clock },
      );

      const changes = product.hasPendingChanges;
      expect(changes).toBe(true);
    });

    it('given markPersisted after a save cycle when inspecting versions then expectedVersion catches up', () => {
      const product = Product.create(
        { id: PRODUCT_ID, organizationId: ORG_ID, name: 'Product' },
        { clock },
      );
      product.activate();
      product.pullDomainEvents();

      product.markPersisted();

      expect(product.expectedVersion).toBe(2);
      expect(product.version).toBe(2);
      expect(product.hasPendingChanges).toBe(false);
    });
  });
});
