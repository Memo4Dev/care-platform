import { PlatformError, ERROR_CODES } from '@commerce-platform/contracts';
import type { CustomerType } from '@commerce-platform/database';

export interface BusinessCustomerState {
  id: string;
  organizationId: string;
  type: CustomerType;
  displayName: string;
  code: string | null;
  phone: string | null;
  email: string | null;
}

/** M5-only Customer aggregate: deliberately excludes CRM/account concerns. */
export class BusinessCustomer {
  private constructor(readonly state: BusinessCustomerState) {}

  static create(state: BusinessCustomerState): BusinessCustomer {
    if (!state.displayName.trim()) {
      throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, 'Customer display name is required.');
    }
    return new BusinessCustomer({ ...state, displayName: state.displayName.trim() });
  }
}
