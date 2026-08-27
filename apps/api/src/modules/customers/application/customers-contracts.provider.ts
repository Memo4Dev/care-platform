import { Inject, Injectable } from '@nestjs/common';

import type { CustomerReferenceView, CustomersContracts } from '../contracts';
import { CustomerService } from './customer.service';

@Injectable()
export class CustomersContractProvider implements CustomersContracts {
  constructor(@Inject(CustomerService) private readonly customers: CustomerService) {}

  async getCustomer(
    organizationId: string,
    customerId: string,
  ): Promise<CustomerReferenceView | null> {
    const row = await this.customers.get(organizationId, customerId);
    return row ? toReferenceView(row) : null;
  }

  async searchCustomers(
    organizationId: string,
    query: string,
    limit: number,
  ): Promise<readonly CustomerReferenceView[]> {
    const rows = await this.customers.search(organizationId, query, limit);
    return rows.map(toReferenceView);
  }
}

function toReferenceView(row: {
  id: string;
  organizationId: string;
  type: 'INDIVIDUAL' | 'BUSINESS';
  displayName: string;
  code: string | null;
}): CustomerReferenceView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    type: row.type,
    displayName: row.displayName,
    code: row.code,
  };
}
