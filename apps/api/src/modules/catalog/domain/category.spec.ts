import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import { Category } from './category';

/** Fixed clock so event timestamps are deterministic in assertions. */
const FIXED_NOW = new Date('2026-01-15T10:00:00.000Z');
const clock = (): Date => new Date(FIXED_NOW);

const ORG_ID = '0198a000-0000-7000-8000-000000000001';
const CATEGORY_ID = '0198a000-0000-7000-8000-000000000020';
const PARENT_ID = '0198a000-0000-7000-8000-000000000021';

describe('Category', () => {
  describe('CreateCategory', () => {
    it('given a valid name when creating then category is active and CategoryCreated event is collected', () => {
      const category = Category.create(
        { id: CATEGORY_ID, organizationId: ORG_ID, name: 'Pharmaceuticals' },
        { clock },
      );

      expect(category.id).toBe(CATEGORY_ID);
      expect(category.name).toBe('Pharmaceuticals');
      expect(category.isActive).toBe(true);
      expect(category.parentId).toBeNull();
      expect(category.sortOrder).toBe(0);
      expect(category.version).toBe(1);
      expect(category.expectedVersion).toBe(0);

      const events = category.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'CategoryCreated',
        occurredAt: FIXED_NOW,
        organizationId: ORG_ID,
        categoryId: CATEGORY_ID,
        name: 'Pharmaceuticals',
        parentId: null,
      });
    });

    it('given a parent when creating then CategoryCreated event includes parentId', () => {
      const category = Category.create(
        { id: CATEGORY_ID, organizationId: ORG_ID, parentId: PARENT_ID, name: 'Analgesics' },
        { clock },
      );

      const events = category.pullDomainEvents();
      expect(events[0]).toMatchObject({
        parentId: PARENT_ID,
      });
    });

    it('given an empty name when creating then VALIDATION_FAILED is raised', () => {
      let error: unknown;
      try {
        Category.create({ id: CATEGORY_ID, organizationId: ORG_ID, name: '   ' }, { clock });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given pulled events when pulling again then the aggregate emits each event exactly once', () => {
      const category = Category.create(
        { id: CATEGORY_ID, organizationId: ORG_ID, name: 'Category' },
        { clock },
      );
      expect(category.pullDomainEvents()).toHaveLength(1);
      expect(category.pullDomainEvents()).toHaveLength(0);
    });
  });

  describe('UpdateCategory', () => {
    it('given an existing category when updating name then name changes and CategoryUpdated is emitted', () => {
      const category = Category.create(
        { id: CATEGORY_ID, organizationId: ORG_ID, name: 'Old Name' },
        { clock },
      );
      category.pullDomainEvents();

      category.update({ name: 'New Name' });

      expect(category.name).toBe('New Name');
      const events = category.pullDomainEvents();
      expect(events).toEqual([
        {
          type: 'CategoryUpdated',
          occurredAt: FIXED_NOW,
          organizationId: ORG_ID,
          categoryId: CATEGORY_ID,
          name: 'New Name',
        },
      ]);
    });

    it('given an existing category when updating sortOrder then sortOrder changes', () => {
      const category = Category.create(
        { id: CATEGORY_ID, organizationId: ORG_ID, name: 'Category', sortOrder: 0 },
        { clock },
      );

      category.update({ sortOrder: 10 });

      expect(category.sortOrder).toBe(10);
    });
  });

  describe('DeactivateCategory', () => {
    it('given an active category when deactivating then isActive becomes false and CategoryDeactivated is emitted', () => {
      const category = Category.create(
        { id: CATEGORY_ID, organizationId: ORG_ID, name: 'Category' },
        { clock },
      );
      category.pullDomainEvents();

      const deactivated = category.deactivate();

      expect(deactivated).toBe(true);
      expect(category.isActive).toBe(false);
      const events = category.pullDomainEvents();
      expect(events).toEqual([
        {
          type: 'CategoryDeactivated',
          occurredAt: FIXED_NOW,
          organizationId: ORG_ID,
          categoryId: CATEGORY_ID,
        },
      ]);
    });

    it('given an already-inactive category when deactivating again then it is an accepted no-op that emits nothing', () => {
      const category = Category.create(
        { id: CATEGORY_ID, organizationId: ORG_ID, name: 'Category' },
        { clock },
      );
      category.deactivate();
      category.pullDomainEvents();
      category.markPersisted();

      const deactivated = category.deactivate();

      expect(deactivated).toBe(false);
      expect(category.isActive).toBe(false);
      expect(category.pullDomainEvents()).toHaveLength(0);
      expect(category.hasPendingChanges).toBe(false);
    });
  });

  describe('change journaling', () => {
    it('given markPersisted after a save cycle when inspecting versions then expectedVersion catches up and journals clear', () => {
      const category = Category.create(
        { id: CATEGORY_ID, organizationId: ORG_ID, name: 'Category' },
        { clock },
      );
      category.deactivate();
      category.pullDomainEvents();

      category.markPersisted();

      expect(category.expectedVersion).toBe(2);
      expect(category.version).toBe(2);
      expect(category.hasPendingChanges).toBe(false);
    });
  });
});
