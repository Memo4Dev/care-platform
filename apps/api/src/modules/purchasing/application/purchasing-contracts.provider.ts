import { Inject, Injectable } from '@nestjs/common';
import { type DatabaseClient } from '@commerce-platform/database';

import { DATABASE } from '../../database/database.tokens';
import { type PurchasingContracts, type SupplierView } from '../contracts';
import { PurchasingRepository } from '../infrastructure/purchasing.repository';

/**
 * Read-model implementation of the Purchasing module contract.
 *
 * Deliberately queries projections directly (SELECT-only) instead of loading
 * aggregates: contract reads must stay cheap. All access is organizationId-scoped.
 */
@Injectable()
export class PurchasingContractProvider implements PurchasingContracts {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(PurchasingRepository) private readonly repository: PurchasingRepository,
  ) {}

  async getSupplier(organizationId: string, supplierId: string): Promise<SupplierView | null> {
    const row = await this.repository.findSupplierById(this.db, organizationId, supplierId);

    if (!row) return null;

    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      code: row.code,
      contactName: row.contactName,
      email: row.email,
      phone: row.phone,
      address: row.address,
      isActive: row.isActive,
      notes: row.notes,
      version: row.version,
    };
  }
}
