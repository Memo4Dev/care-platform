import { createHash } from 'node:crypto';
import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import { newId, type DatabaseClient, type CustomerType } from '@commerce-platform/database';
import { Inject, Injectable } from '@nestjs/common';

import { DATABASE } from '../../database/database.tokens';
import { BusinessCustomer } from '../domain/business-customer';
import { CustomerRepository, type CustomerRow } from '../infrastructure/customer.repository';

@Injectable()
export class CustomerService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(CustomerRepository) private readonly repository: CustomerRepository,
  ) {}

  get(organizationId: string, id: string) {
    return this.repository.findById(this.db, organizationId, id);
  }
  search(organizationId: string, query: string, limit: number) {
    return this.repository.search(this.db, organizationId, query, limit);
  }

  async create(
    organizationId: string,
    input: {
      type: CustomerType;
      displayName: string;
      code?: string | null;
      phone?: string | null;
      email?: string | null;
    },
    idempotencyKey: string,
    actorId: string,
    correlationId: string,
  ): Promise<CustomerResult> {
    return this.db.transaction(async (tx) => {
      const normalizedInput = {
        type: input.type,
        displayName: input.displayName,
        code: input.code ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
      };
      const requestHash = createHash('sha256')
        .update(JSON.stringify(normalizedInput))
        .digest('hex');
      const claim = await this.repository.claimIdempotency(
        tx,
        idempotencyKey,
        `ORGANIZATION_USER:${actorId}:${organizationId}:POST:/api/v1/admin/customers`,
        requestHash,
      );
      if (claim.kind === 'existing') {
        if (claim.row.requestHash !== requestHash)
          throw PlatformError.idempotencyConflict(
            'Idempotency-Key was used with a different customer request.',
          );
        if (claim.row.status === 'COMPLETED' && claim.row.responseJson)
          return claim.row.responseJson as CustomerResult;
        throw PlatformError.idempotencyConflict('Customer creation is already in progress.');
      }
      if (
        normalizedInput.code &&
        (await this.repository.findByCode(tx, organizationId, normalizedInput.code))
      )
        throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, 'Customer code already exists.');
      const aggregate = BusinessCustomer.create({
        id: newId(),
        organizationId,
        ...normalizedInput,
      });
      const row = await this.repository.create(tx, aggregate.state);
      const result = toCustomerResult(row);
      await this.repository.writeOutbox(tx, organizationId, row, actorId, correlationId);
      await this.repository.completeIdempotency(tx, claim.id, result);
      return result;
    });
  }
}

export type CustomerResult = Pick<
  CustomerRow,
  'id' | 'organizationId' | 'type' | 'displayName' | 'code' | 'createdAt' | 'updatedAt' | 'version'
>;

function toCustomerResult(row: CustomerRow): CustomerResult {
  return {
    id: row.id,
    organizationId: row.organizationId,
    type: row.type,
    displayName: row.displayName,
    code: row.code,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}
