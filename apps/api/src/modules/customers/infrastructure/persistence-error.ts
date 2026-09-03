import { PlatformError } from '@commerce-platform/contracts';

interface PgLikeError {
  code?: unknown;
  constraint?: unknown;
  cause?: unknown;
}

/**
 * Maps the customer business-key constraint to the stable API validation
 * contract while preserving unexpected persistence failures unchanged.
 */
export function mapPersistenceError(error: unknown): unknown {
  const wrapped = error as PgLikeError | null;
  const candidate =
    wrapped && typeof wrapped === 'object' && wrapped.cause && typeof wrapped.cause === 'object'
      ? (wrapped.cause as PgLikeError)
      : wrapped;

  if (
    !candidate ||
    typeof candidate !== 'object' ||
    candidate.code !== '23505' ||
    typeof candidate.constraint !== 'string'
  ) {
    return error;
  }

  const field =
    candidate.constraint === 'business_customers_org_code_unique' ? 'code' : 'constraint';
  return PlatformError.validationFailed('Customer business key already exists.', {
    details: {
      constraint: candidate.constraint,
      field,
    },
    cause: error,
  });
}
