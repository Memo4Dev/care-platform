import { describe, expect, it } from 'vitest';

import { ApiErrorBody } from './api';
import {
  ERROR_CODES,
  ERROR_CODE_VALUES,
  httpStatusFor,
  isErrorCode,
  isPlatformError,
  PlatformError,
} from './errors';

describe('error catalog', () => {
  it('contains every documented code exactly once', () => {
    // The catalog is a stable contract (62-error-codes.md). If this count
    // changes, the architecture doc and this package must change together.
    expect(ERROR_CODE_VALUES).toHaveLength(70);
    expect(new Set(ERROR_CODE_VALUES).size).toBe(ERROR_CODE_VALUES.length);
  });

  it('exposes codes as const object entries matching the values', () => {
    for (const value of Object.values(ERROR_CODES)) {
      expect(isErrorCode(value)).toBe(true);
    }
    expect(isErrorCode('NOT_A_REAL_CODE')).toBe(false);
    expect(isErrorCode(42)).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
  });

  it('freezes the flat value list so consumers cannot mutate it', () => {
    expect(Object.isFrozen(ERROR_CODE_VALUES)).toBe(true);
  });
});

describe('HTTP status mapping', () => {
  it.each([
    ['VALIDATION_FAILED', 422],
    ['RESOURCE_NOT_FOUND', 404],
    ['AUTHENTICATION_REQUIRED', 401],
    ['INVALID_CREDENTIALS', 401],
    ['DEVICE_NOT_REGISTERED', 401],
    ['PERMISSION_DENIED', 403],
    ['BRANCH_ACCESS_DENIED', 403],
    ['OVERRIDE_PERMISSION_REQUIRED', 403],
    ['TENANT_SUSPENDED', 403],
    ['PLAN_LIMIT_REACHED', 403],
    ['FEATURE_NOT_ENTITLED', 403],
    ['SUBSCRIPTION_PAST_DUE', 403],
    ['RESOURCE_VERSION_CONFLICT', 409],
    ['IDEMPOTENCY_CONFLICT', 409],
    ['INVENTORY_INSUFFICIENT', 409],
    ['SALE_ALREADY_COMPLETED', 409],
    ['PAYMENT_REQUIRED', 402],
    ['PAYMENT_FAILED', 402],
    ['DELIVERY_PROVIDER_UNAVAILABLE', 502],
  ] as const)('maps %s to HTTP %i', (code, expectedStatus) => {
    expect(httpStatusFor(code)).toBe(expectedStatus);
  });

  it('covers the whole catalog and falls back to 500 for unknowns', () => {
    for (const code of ERROR_CODE_VALUES) {
      const status = httpStatusFor(code);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
      expect(status).not.toBe(500); // every known code has a real mapping
    }
    expect(httpStatusFor('SOMETHING_ELSE')).toBe(500);
  });
});

describe('PlatformError', () => {
  it('is an Error carrying code, status, details and correlation id', () => {
    const cause = new Error('boom');
    const error = new PlatformError(ERROR_CODES.INVENTORY_INSUFFICIENT, 'Out of stock', {
      details: { variantId: 'v-1', requested: '3' },
      correlationId: 'corr-123',
      cause,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PlatformError');
    expect(error.code).toBe('INVENTORY_INSUFFICIENT');
    expect(error.httpStatus).toBe(409);
    expect(error.details).toEqual({ variantId: 'v-1', requested: '3' });
    expect(error.correlationId).toBe('corr-123');
    expect(error.message).toBe('Out of stock');
  });

  it('serializes into the standard error envelope payload', () => {
    const error = PlatformError.validationFailed('Bad quantity', {
      details: { field: 'quantity' },
      correlationId: 'corr-9',
    });

    const body: ApiErrorBody = { error: error.toApiError() };

    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toBe('Bad quantity');
    expect(body.error.details).toEqual({ field: 'quantity' });
    expect(body.error.correlationId).toBe('corr-9');

    const bare = PlatformError.notFound('Variant missing').toApiError();
    expect(bare.details).toBeUndefined();
    expect(bare.correlationId).toBeUndefined();
  });

  it('exposes factories with conventional defaults', () => {
    expect(PlatformError.notFound('x').code).toBe('RESOURCE_NOT_FOUND');
    expect(PlatformError.validationFailed('x').httpStatus).toBe(422);
    expect(PlatformError.permissionDenied().code).toBe('PERMISSION_DENIED');
    expect(PlatformError.permissionDenied().message).toBe('Permission denied.');
    expect(PlatformError.invalidCredentials().httpStatus).toBe(401);
    expect(PlatformError.branchAccessDenied().httpStatus).toBe(403);
    expect(PlatformError.tenantSuspended().httpStatus).toBe(403);
    expect(PlatformError.planLimitReached('limit').code).toBe('PLAN_LIMIT_REACHED');
    expect(PlatformError.featureNotEntitled('feature').httpStatus).toBe(403);
    expect(PlatformError.versionConflict('stale').code).toBe('RESOURCE_VERSION_CONFLICT');
    expect(PlatformError.idempotencyConflict('dup').httpStatus).toBe(409);
    expect(PlatformError.of('CASH_SESSION_REQUIRED', 'open one').httpStatus).toBe(409);
  });

  it('keeps an optional cause non-enumerable', () => {
    const cause = new Error('root');
    const error = PlatformError.of(ERROR_CODES.PAYMENT_FAILED, 'declined', { cause });

    expect((error as unknown as { cause: unknown }).cause).toBe(cause);
    expect(JSON.parse(JSON.stringify(error.toApiError())).code).toBe('PAYMENT_FAILED');
  });
});

describe('isPlatformError', () => {
  it('accepts real instances', () => {
    expect(isPlatformError(PlatformError.notFound('x'))).toBe(true);
  });

  it('recognizes structurally identical errors across package copies', () => {
    const foreign = Object.assign(new Error('cross-realm'), {
      name: 'PlatformError',
      code: 'RESOURCE_NOT_FOUND',
      httpStatus: 404,
    });
    expect(isPlatformError(foreign)).toBe(true);
  });

  it('rejects plain errors, shapes with bad codes and non-errors', () => {
    expect(isPlatformError(new Error('plain'))).toBe(false);
    expect(
      isPlatformError(
        Object.assign(new Error('bad code'), {
          name: 'PlatformError',
          code: 'MADE_UP',
          httpStatus: 404,
        }),
      ),
    ).toBe(false);
    expect(isPlatformError({ code: 'RESOURCE_NOT_FOUND' })).toBe(false);
    expect(isPlatformError(null)).toBe(false);
    expect(isPlatformError('RESOURCE_NOT_FOUND')).toBe(false);
  });
});
