import { PlatformError } from '@commerce-platform/contracts';

interface PgLikeError {
  code?: unknown;
  constraint?: unknown;
  cause?: unknown;
}

/** Map expected Cart storage constraints to stable validation errors. */
export function mapPersistenceError(error: unknown): unknown {
  const wrapped = isPgLikeError(error) ? error : null;
  const candidate = wrapped && isPgLikeError(wrapped.cause) ? wrapped.cause : wrapped;

  if (!candidate || typeof candidate !== 'object' || typeof candidate.code !== 'string') {
    return error;
  }

  if (candidate.code === '23503') {
    return PlatformError.validationFailed('Cart contains a reference outside its organization.', {
      details: { reference: referenceFor(candidate.constraint) },
      cause: error,
    });
  }

  if (candidate.code === '23505') {
    return PlatformError.validationFailed('Cart item already exists for this variant and unit.', {
      details: { field: 'items' },
      cause: error,
    });
  }

  if (candidate.code === '23514') {
    return PlatformError.validationFailed('Cart data violates a persistence invariant.', {
      details: { field: 'quantity' },
      cause: error,
    });
  }

  return error;
}

function referenceFor(constraint: unknown): string {
  switch (constraint) {
    case 'carts_branch_tenant_fk':
      return 'branchId';
    case 'cart_items_cart_tenant_fk':
      return 'cartId';
    case 'cart_items_variant_tenant_fk':
      return 'variantId';
    case 'cart_items_unit_tenant_fk':
      return 'unitId';
    default:
      return 'tenantReference';
  }
}

function isPgLikeError(value: unknown): value is PgLikeError {
  return typeof value === 'object' && value !== null;
}
