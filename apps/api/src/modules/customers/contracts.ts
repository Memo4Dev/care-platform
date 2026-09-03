/**
 * Public contract of the Customers bounded context.
 *
 * Sales consumes this reference view rather than Customer persistence or the
 * concrete CustomerService (docs/architecture/60-module-contracts.md).
 */
export const CUSTOMERS_CONTRACTS = Symbol('CUSTOMERS_CONTRACTS');

export interface CustomerReferenceView {
  readonly id: string;
  readonly organizationId: string;
  readonly type: 'INDIVIDUAL' | 'BUSINESS';
  readonly displayName: string;
  readonly code: string | null;
}

export interface CustomersContracts {
  getCustomer(organizationId: string, customerId: string): Promise<CustomerReferenceView | null>;
  searchCustomers(
    organizationId: string,
    query: string,
    limit: number,
  ): Promise<readonly CustomerReferenceView[]>;
}
