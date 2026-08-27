import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import { Supplier } from './supplier';

// ---------------------------------------------------------------------------
// Deterministic test data
// ---------------------------------------------------------------------------
const ORG_ID = '01980000-0000-7000-8000-000000000001';
const SUPPLIER_ID = '01980000-0000-7000-8000-000000000050';
const CLOCK = () => new Date('2025-06-15T10:00:00Z');

describe('Supplier', () => {
  // =========================================================================
  // Creation
  // =========================================================================
  describe('create', () => {
    it('given valid input when creating then supplier is active with correct fields', () => {
      const supplier = Supplier.create(
        {
          id: SUPPLIER_ID,
          organizationId: ORG_ID,
          name: 'Acme Parts',
          code: 'SUP-001',
          contactName: 'Jane Doe',
          email: 'jane@acme.com',
          phone: '+1-555-0100',
          address: '123 Main St',
          notes: 'Preferred vendor',
        },
        { clock: CLOCK },
      );

      expect(supplier.id).toBe(SUPPLIER_ID);
      expect(supplier.organizationId).toBe(ORG_ID);
      expect(supplier.name).toBe('Acme Parts');
      expect(supplier.code).toBe('SUP-001');
      expect(supplier.contactName).toBe('Jane Doe');
      expect(supplier.email).toBe('jane@acme.com');
      expect(supplier.phone).toBe('+1-555-0100');
      expect(supplier.address).toBe('123 Main St');
      expect(supplier.notes).toBe('Preferred vendor');
      expect(supplier.isActive).toBe(true);
      expect(supplier.version).toBe(1);
      expect(supplier.expectedVersion).toBe(0);
      expect(supplier.hasPendingChanges).toBe(true);
    });

    it('given valid input when creating then SupplierCreated event emitted', () => {
      const supplier = Supplier.create(
        {
          id: SUPPLIER_ID,
          organizationId: ORG_ID,
          name: 'Acme Parts',
          code: 'SUP-001',
        },
        { clock: CLOCK },
      );

      const events = supplier.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('SupplierCreated');
      if (events[0].type === 'SupplierCreated') {
        expect(events[0].aggregateId).toBe(SUPPLIER_ID);
        expect(events[0].organizationId).toBe(ORG_ID);
        expect(events[0].name).toBe('Acme Parts');
        expect(events[0].code).toBe('SUP-001');
      }
    });

    it('given empty name when creating then throws VALIDATION_FAILED', () => {
      let error: unknown;
      try {
        Supplier.create({
          id: SUPPLIER_ID,
          organizationId: ORG_ID,
          name: '',
          code: 'SUP-001',
        });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given empty code when creating then throws VALIDATION_FAILED', () => {
      let error: unknown;
      try {
        Supplier.create({
          id: SUPPLIER_ID,
          organizationId: ORG_ID,
          name: 'Acme Parts',
          code: '',
        });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given whitespace-only name when creating then throws VALIDATION_FAILED', () => {
      let error: unknown;
      try {
        Supplier.create({
          id: SUPPLIER_ID,
          organizationId: ORG_ID,
          name: '   ',
          code: 'SUP-001',
        });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });

  // =========================================================================
  // Reconstitution
  // =========================================================================
  describe('reconstitute', () => {
    it('given reconstituted supplier when querying then state matches', () => {
      const supplier = Supplier.reconstitute({
        id: SUPPLIER_ID,
        organizationId: ORG_ID,
        name: 'Acme Parts',
        code: 'SUP-001',
        contactName: 'Jane Doe',
        email: 'jane@acme.com',
        phone: '+1-555-0100',
        address: '123 Main St',
        isActive: true,
        notes: 'Preferred vendor',
        version: 3,
      });

      expect(supplier.id).toBe(SUPPLIER_ID);
      expect(supplier.organizationId).toBe(ORG_ID);
      expect(supplier.name).toBe('Acme Parts');
      expect(supplier.code).toBe('SUP-001');
      expect(supplier.contactName).toBe('Jane Doe');
      expect(supplier.email).toBe('jane@acme.com');
      expect(supplier.phone).toBe('+1-555-0100');
      expect(supplier.address).toBe('123 Main St');
      expect(supplier.notes).toBe('Preferred vendor');
      expect(supplier.isActive).toBe(true);
      expect(supplier.version).toBe(3);
      expect(supplier.expectedVersion).toBe(3);
      expect(supplier.hasPendingChanges).toBe(false);
      expect(supplier.pullDomainEvents()).toHaveLength(0);
    });

    it('given reconstituted inactive supplier when querying then isActive=false', () => {
      const supplier = Supplier.reconstitute({
        id: SUPPLIER_ID,
        organizationId: ORG_ID,
        name: 'Acme Parts',
        code: 'SUP-001',
        isActive: false,
        version: 2,
      });

      expect(supplier.isActive).toBe(false);
    });
  });

  // =========================================================================
  // updateName
  // =========================================================================
  describe('updateName', () => {
    it('given active supplier when updating name then name changes and event emitted', () => {
      const supplier = Supplier.create(
        {
          id: SUPPLIER_ID,
          organizationId: ORG_ID,
          name: 'Acme Parts',
          code: 'SUP-001',
        },
        { clock: CLOCK },
      );
      // drain creation event
      supplier.pullDomainEvents();

      supplier.updateName('Acme Industries');

      expect(supplier.name).toBe('Acme Industries');
      expect(supplier.version).toBe(2);

      const events = supplier.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('SupplierUpdated');
      if (events[0].type === 'SupplierUpdated') {
        expect(events[0].name).toBe('Acme Industries');
        expect(events[0].aggregateId).toBe(SUPPLIER_ID);
      }
    });

    it('given active supplier when updating name to empty then throws VALIDATION_FAILED', () => {
      const supplier = Supplier.create(
        {
          id: SUPPLIER_ID,
          organizationId: ORG_ID,
          name: 'Acme Parts',
          code: 'SUP-001',
        },
        { clock: CLOCK },
      );

      let error: unknown;
      try {
        supplier.updateName('');
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });

  // =========================================================================
  // deactivate
  // =========================================================================
  describe('deactivate', () => {
    it('given active supplier when deactivating then isActive=false and event emitted', () => {
      const supplier = Supplier.create(
        {
          id: SUPPLIER_ID,
          organizationId: ORG_ID,
          name: 'Acme Parts',
          code: 'SUP-001',
        },
        { clock: CLOCK },
      );
      supplier.pullDomainEvents();

      supplier.deactivate();

      expect(supplier.isActive).toBe(false);
      expect(supplier.version).toBe(2);

      const events = supplier.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('SupplierDeactivated');
      if (events[0].type === 'SupplierDeactivated') {
        expect(events[0].aggregateId).toBe(SUPPLIER_ID);
        expect(events[0].organizationId).toBe(ORG_ID);
      }
    });

    it('given already inactive supplier when deactivating then throws OPERATION_NOT_ALLOWED', () => {
      const supplier = Supplier.reconstitute({
        id: SUPPLIER_ID,
        organizationId: ORG_ID,
        name: 'Acme Parts',
        code: 'SUP-001',
        isActive: false,
        version: 2,
      });

      let error: unknown;
      try {
        supplier.deactivate();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
      expect(supplier.isActive).toBe(false);
    });
  });

  // =========================================================================
  // Persistence collaboration
  // =========================================================================
  describe('persistence', () => {
    it('given supplier when markPersisted then hasPendingChanges=false', () => {
      const supplier = Supplier.create(
        {
          id: SUPPLIER_ID,
          organizationId: ORG_ID,
          name: 'Acme Parts',
          code: 'SUP-001',
        },
        { clock: CLOCK },
      );

      expect(supplier.hasPendingChanges).toBe(true);

      supplier.markPersisted();

      expect(supplier.hasPendingChanges).toBe(false);
      expect(supplier.version).toBe(1);
      expect(supplier.expectedVersion).toBe(1);
    });
  });
});
