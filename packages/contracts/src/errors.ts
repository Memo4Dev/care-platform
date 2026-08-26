/**
 * Stable machine-readable error catalog and the `PlatformError` primitive.
 *
 * Source of truth: `docs/architecture/62-error-codes.md`.
 * The codes below are a stable contract: consumers match on `code`, never on
 * message text or HTTP status. Adding codes is additive and safe; renaming or
 * removing codes is a breaking contract change.
 */
import type { ApiError } from './api';

/**
 * Every error code from the architecture error catalog, verbatim, grouped by
 * the doc's sections. Keep this object in sync with 62-error-codes.md.
 */
export const ERROR_CODES = {
  // General
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_VERSION_CONFLICT: 'RESOURCE_VERSION_CONFLICT',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  OPERATION_NOT_ALLOWED: 'OPERATION_NOT_ALLOWED',
  POLICY_VIOLATION: 'POLICY_VIOLATION',

  // Authentication / Authorization
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  DEVICE_NOT_REGISTERED: 'DEVICE_NOT_REGISTERED',
  DEVICE_REVOKED: 'DEVICE_REVOKED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  BRANCH_ACCESS_DENIED: 'BRANCH_ACCESS_DENIED',
  OVERRIDE_PERMISSION_REQUIRED: 'OVERRIDE_PERMISSION_REQUIRED',

  // Tenant / Subscription
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  TENANT_PROVISIONING_INCOMPLETE: 'TENANT_PROVISIONING_INCOMPLETE',
  SUBSCRIPTION_INACTIVE: 'SUBSCRIPTION_INACTIVE',
  SUBSCRIPTION_PAST_DUE: 'SUBSCRIPTION_PAST_DUE',
  FEATURE_NOT_ENTITLED: 'FEATURE_NOT_ENTITLED',
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',

  // Catalog / Pricing
  VARIANT_NOT_SELLABLE: 'VARIANT_NOT_SELLABLE',
  BARCODE_NOT_FOUND: 'BARCODE_NOT_FOUND',
  INVALID_UNIT_CONVERSION: 'INVALID_UNIT_CONVERSION',
  PRICE_NOT_AVAILABLE: 'PRICE_NOT_AVAILABLE',
  COUPON_INVALID: 'COUPON_INVALID',
  COUPON_EXPIRED: 'COUPON_EXPIRED',
  PROMOTION_NOT_APPLICABLE: 'PROMOTION_NOT_APPLICABLE',
  PRICE_OVERRIDE_NOT_ALLOWED: 'PRICE_OVERRIDE_NOT_ALLOWED',

  // Inventory
  INVENTORY_POSITION_NOT_FOUND: 'INVENTORY_POSITION_NOT_FOUND',
  INVENTORY_INSUFFICIENT: 'INVENTORY_INSUFFICIENT',
  RESERVATION_NOT_AVAILABLE: 'RESERVATION_NOT_AVAILABLE',
  RESERVATION_EXPIRED: 'RESERVATION_EXPIRED',
  RESERVATION_ALREADY_CONSUMED: 'RESERVATION_ALREADY_CONSUMED',
  ALLOCATION_INSUFFICIENT: 'ALLOCATION_INSUFFICIENT',
  TRANSFER_INVALID_STATE: 'TRANSFER_INVALID_STATE',
  TRANSFER_DISCREPANCY: 'TRANSFER_DISCREPANCY',
  STOCK_ADJUSTMENT_APPROVAL_REQUIRED: 'STOCK_ADJUSTMENT_APPROVAL_REQUIRED',

  // Orders / Sales
  ORDER_INVALID_STATE: 'ORDER_INVALID_STATE',
  ORDER_MODIFICATION_NOT_ALLOWED: 'ORDER_MODIFICATION_NOT_ALLOWED',
  ORDER_APPROVAL_REQUIRED: 'ORDER_APPROVAL_REQUIRED',
  SALE_INVALID_STATE: 'SALE_INVALID_STATE',
  SALE_ALREADY_COMPLETED: 'SALE_ALREADY_COMPLETED',
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  OFFLINE_VERIFICATION_REQUIRED: 'OFFLINE_VERIFICATION_REQUIRED',

  // Payments / Credit
  PAYMENT_METHOD_DISABLED: 'PAYMENT_METHOD_DISABLED',
  PAYMENT_ALREADY_COMPLETED: 'PAYMENT_ALREADY_COMPLETED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  REFUND_AMOUNT_EXCEEDED: 'REFUND_AMOUNT_EXCEEDED',
  REFUND_DESTINATION_UNAVAILABLE: 'REFUND_DESTINATION_UNAVAILABLE',
  CREDIT_NOT_ALLOWED: 'CREDIT_NOT_ALLOWED',
  CREDIT_LIMIT_EXCEEDED: 'CREDIT_LIMIT_EXCEEDED',
  WALLET_BALANCE_INSUFFICIENT: 'WALLET_BALANCE_INSUFFICIENT',

  // Cash
  CASH_SESSION_REQUIRED: 'CASH_SESSION_REQUIRED',
  CASH_SESSION_ALREADY_OPEN: 'CASH_SESSION_ALREADY_OPEN',
  CASH_SESSION_CLOSED: 'CASH_SESSION_CLOSED',
  CASH_BALANCE_INSUFFICIENT: 'CASH_BALANCE_INSUFFICIENT',
  CASH_RECONCILIATION_REQUIRED: 'CASH_RECONCILIATION_REQUIRED',

  // Returns
  RETURN_NOT_ELIGIBLE: 'RETURN_NOT_ELIGIBLE',
  RETURN_WINDOW_EXPIRED: 'RETURN_WINDOW_EXPIRED',
  RETURN_QUANTITY_EXCEEDED: 'RETURN_QUANTITY_EXCEEDED',
  RETURN_INSPECTION_REQUIRED: 'RETURN_INSPECTION_REQUIRED',

  // Delivery
  DELIVERY_QUOTE_UNAVAILABLE: 'DELIVERY_QUOTE_UNAVAILABLE',
  DELIVERY_PROVIDER_UNAVAILABLE: 'DELIVERY_PROVIDER_UNAVAILABLE',
  DELIVERY_INVALID_STATE: 'DELIVERY_INVALID_STATE',
  DELIVERY_RETRY_LIMIT_REACHED: 'DELIVERY_RETRY_LIMIT_REACHED',

  // Offline Sync
  OFFLINE_SEQUENCE_GAP: 'OFFLINE_SEQUENCE_GAP',
  OFFLINE_OPERATION_REJECTED: 'OFFLINE_OPERATION_REJECTED',
  OFFLINE_OPERATION_DUPLICATE: 'OFFLINE_OPERATION_DUPLICATE',
  OFFLINE_CONFLICT_DETECTED: 'OFFLINE_CONFLICT_DETECTED',
  OFFLINE_CONFLICT_ALREADY_RESOLVED: 'OFFLINE_CONFLICT_ALREADY_RESOLVED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Flat list of every catalog code; used by schema validation and guards.
 * Frozen so consumers cannot mutate the shared contract list at runtime.
 */
export const ERROR_CODE_VALUES: readonly ErrorCode[] = Object.freeze(
  Object.values(ERROR_CODES),
);

/**
 * Mapping from each error code to its HTTP status.
 *
 * Convention table (documented choices):
 *
 * - 401 Unauthorized — authentication boundary failures. Device registration
 *   and revocation are part of the POS device credential factor
 *   (`63-openapi-boundaries.md`), so DEVICE_* codes map here too.
 * - 402 Payment Required — reserved strictly for payment execution outcomes
 *   where the reason phrase is semantically exact (PAYMENT_REQUIRED,
 *   PAYMENT_FAILED). Subscription/quota gating deliberately does NOT use 402;
 *   entitlement enforcement maps to 403 so SaaS gating stays uniform.
 * - 403 Forbidden — authorization, policy, approval gates and subscription/
 *   quota limits: request understood and identity known, but refused.
 * - 404 Not Found — addressed resource does not exist.
 * - 409 Conflict — aggregate/state conflicts: version conflicts, duplicate or
 *   already-consumed operations, insufficient stock/balance families, closed
 *   or missing workflow preconditions, offline replay conflicts.
 * - 422 Unprocessable Entity — well-formed request whose content violates
 *   business rules (validation, expired/invalid references, eligibility).
 *   Note: RESERVATION_EXPIRED is 409 because it invalidates held state inside
 *   an active reservation workflow, while RETURN_WINDOW_EXPIRED is an
 *   eligibility rule over the submitted request (422).
 * - 502 Bad Gateway — downstream provider unavailability/failure.
 * - Anything unmapped falls back to 500 via {@link httpStatusFor}.
 */
const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  // General
  VALIDATION_FAILED: 422,
  RESOURCE_NOT_FOUND: 404,
  RESOURCE_VERSION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  OPERATION_NOT_ALLOWED: 403,
  POLICY_VIOLATION: 403,

  // Authentication / Authorization
  AUTHENTICATION_REQUIRED: 401,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_SUSPENDED: 403,
  DEVICE_NOT_REGISTERED: 401,
  DEVICE_REVOKED: 401,
  PERMISSION_DENIED: 403,
  BRANCH_ACCESS_DENIED: 403,
  OVERRIDE_PERMISSION_REQUIRED: 403,

  // Tenant / Subscription
  TENANT_SUSPENDED: 403,
  TENANT_PROVISIONING_INCOMPLETE: 409,
  SUBSCRIPTION_INACTIVE: 403,
  SUBSCRIPTION_PAST_DUE: 403,
  FEATURE_NOT_ENTITLED: 403,
  PLAN_LIMIT_REACHED: 403,

  // Catalog / Pricing
  VARIANT_NOT_SELLABLE: 409,
  BARCODE_NOT_FOUND: 404,
  INVALID_UNIT_CONVERSION: 422,
  PRICE_NOT_AVAILABLE: 422,
  COUPON_INVALID: 422,
  COUPON_EXPIRED: 422,
  PROMOTION_NOT_APPLICABLE: 422,
  PRICE_OVERRIDE_NOT_ALLOWED: 403,

  // Inventory
  INVENTORY_POSITION_NOT_FOUND: 404,
  INVENTORY_INSUFFICIENT: 409,
  RESERVATION_NOT_AVAILABLE: 409,
  RESERVATION_EXPIRED: 409,
  RESERVATION_ALREADY_CONSUMED: 409,
  ALLOCATION_INSUFFICIENT: 409,
  TRANSFER_INVALID_STATE: 409,
  TRANSFER_DISCREPANCY: 409,
  STOCK_ADJUSTMENT_APPROVAL_REQUIRED: 403,

  // Orders / Sales
  ORDER_INVALID_STATE: 409,
  ORDER_MODIFICATION_NOT_ALLOWED: 409,
  ORDER_APPROVAL_REQUIRED: 403,
  SALE_INVALID_STATE: 409,
  SALE_ALREADY_COMPLETED: 409,
  PAYMENT_REQUIRED: 402,
  OFFLINE_VERIFICATION_REQUIRED: 409,

  // Payments / Credit
  PAYMENT_METHOD_DISABLED: 403,
  PAYMENT_ALREADY_COMPLETED: 409,
  PAYMENT_FAILED: 402,
  REFUND_AMOUNT_EXCEEDED: 409,
  REFUND_DESTINATION_UNAVAILABLE: 409,
  CREDIT_NOT_ALLOWED: 403,
  CREDIT_LIMIT_EXCEEDED: 409,
  WALLET_BALANCE_INSUFFICIENT: 409,

  // Cash
  CASH_SESSION_REQUIRED: 409,
  CASH_SESSION_ALREADY_OPEN: 409,
  CASH_SESSION_CLOSED: 409,
  CASH_BALANCE_INSUFFICIENT: 409,
  CASH_RECONCILIATION_REQUIRED: 409,

  // Returns
  RETURN_NOT_ELIGIBLE: 422,
  RETURN_WINDOW_EXPIRED: 422,
  RETURN_QUANTITY_EXCEEDED: 409,
  RETURN_INSPECTION_REQUIRED: 409,

  // Delivery
  DELIVERY_QUOTE_UNAVAILABLE: 502,
  DELIVERY_PROVIDER_UNAVAILABLE: 502,
  DELIVERY_INVALID_STATE: 409,
  DELIVERY_RETRY_LIMIT_REACHED: 409,

  // Offline Sync
  OFFLINE_SEQUENCE_GAP: 409,
  OFFLINE_OPERATION_REJECTED: 422,
  OFFLINE_OPERATION_DUPLICATE: 409,
  OFFLINE_CONFLICT_DETECTED: 409,
  OFFLINE_CONFLICT_ALREADY_RESOLVED: 409,
};

/**
 * Resolve the conventional HTTP status for an error code.
 * Unknown values fall back to 500 so unexpected codes never leak as 200s.
 */
export function httpStatusFor(code: string): number {
  if (Object.prototype.hasOwnProperty.call(ERROR_HTTP_STATUS, code)) {
    return ERROR_HTTP_STATUS[code as ErrorCode];
  }
  return 500;
}

/** Narrow an unknown value to {@link ErrorCode}. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return (
    typeof value === 'string' && ERROR_CODE_VALUES.includes(value as ErrorCode)
  );
}

/** Options accepted by the {@link PlatformError} constructor. */
export interface PlatformErrorOptions {
  /** Machine-readable, non-sensitive context for clients and support. */
  details?: Record<string, unknown>;
  /** Correlation id to propagate through the error envelope. */
  correlationId?: string;
  /** Underlying cause (e.g. adapter/provider error). Never serialized raw. */
  cause?: unknown;
}

/**
 * The platform-wide application error carrying the stable {@link ErrorCode}.
 *
 * Throw this from use cases; API adapters serialize it into the standard
 * error envelope (`{ error: { code, message, details?, correlationId? } }`)
 * using {@link PlatformError.toApiError} and drive the HTTP status from
 * {@link httpStatusFor}.
 */
export class PlatformError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;
  readonly correlationId?: string;

  constructor(code: ErrorCode, message: string, options: PlatformErrorOptions = {}) {
    super(message);
    this.name = 'PlatformError';
    this.code = code;
    this.httpStatus = httpStatusFor(code);
    if (options.details !== undefined) {
      this.details = options.details;
    }
    if (options.correlationId !== undefined) {
      this.correlationId = options.correlationId;
    }
    if (options.cause !== undefined) {
      // ES2022 Error cause; kept out of serialization targets explicitly.
      Object.defineProperty(this, 'cause', {
        value: options.cause,
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
  }

  /** Serialize into the standard `ApiError` payload (see 51-api-conventions.md). */
  toApiError(): ApiError {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
      ...(this.correlationId === undefined
        ? {}
        : { correlationId: this.correlationId }),
    };
  }

  static validationFailed(
    message: string,
    options: PlatformErrorOptions = {},
  ): PlatformError {
    return new PlatformError(ERROR_CODES.VALIDATION_FAILED, message, options);
  }

  static notFound(message: string, options: PlatformErrorOptions = {}): PlatformError {
    return new PlatformError(ERROR_CODES.RESOURCE_NOT_FOUND, message, options);
  }

  static authenticationRequired(
    message = 'Authentication required.',
    options: PlatformErrorOptions = {},
  ): PlatformError {
    return new PlatformError(ERROR_CODES.AUTHENTICATION_REQUIRED, message, options);
  }

  static invalidCredentials(
    message = 'Invalid credentials.',
    options: PlatformErrorOptions = {},
  ): PlatformError {
    return new PlatformError(ERROR_CODES.INVALID_CREDENTIALS, message, options);
  }

  static permissionDenied(
    message = 'Permission denied.',
    options: PlatformErrorOptions = {},
  ): PlatformError {
    return new PlatformError(ERROR_CODES.PERMISSION_DENIED, message, options);
  }

  static branchAccessDenied(
    message = 'Access to the requested branch is denied.',
    options: PlatformErrorOptions = {},
  ): PlatformError {
    return new PlatformError(ERROR_CODES.BRANCH_ACCESS_DENIED, message, options);
  }

  static featureNotEntitled(
    message: string,
    options: PlatformErrorOptions = {},
  ): PlatformError {
    return new PlatformError(ERROR_CODES.FEATURE_NOT_ENTITLED, message, options);
  }

  static planLimitReached(
    message: string,
    options: PlatformErrorOptions = {},
  ): PlatformError {
    return new PlatformError(ERROR_CODES.PLAN_LIMIT_REACHED, message, options);
  }

  static tenantSuspended(
    message = 'The organization is suspended.',
    options: PlatformErrorOptions = {},
  ): PlatformError {
    return new PlatformError(ERROR_CODES.TENANT_SUSPENDED, message, options);
  }

  static versionConflict(
    message: string,
    options: PlatformErrorOptions = {},
  ): PlatformError {
    return new PlatformError(ERROR_CODES.RESOURCE_VERSION_CONFLICT, message, options);
  }

  static idempotencyConflict(
    message: string,
    options: PlatformErrorOptions = {},
  ): PlatformError {
    return new PlatformError(ERROR_CODES.IDEMPOTENCY_CONFLICT, message, options);
  }

  /**
   * Build a `PlatformError` for any catalog code at runtime (useful for
   * mapping domain results that only carry a code string).
   */
  static of(code: ErrorCode, message: string, options: PlatformErrorOptions = {}) {
    return new PlatformError(code, message, options);
  }
}

/**
 * Type guard for {@link PlatformError}.
 *
 * Beyond `instanceof` it performs a structural check so instances crossing
 * bundle/realm boundaries (duplicate package copies) are still recognized.
 */
export function isPlatformError(value: unknown): value is PlatformError {
  if (value instanceof PlatformError) {
    return true;
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<PlatformError>;
  return (
    candidate.name === 'PlatformError' &&
    isErrorCode(candidate.code) &&
    typeof candidate.httpStatus === 'number' &&
    typeof candidate.message === 'string'
  );
}
