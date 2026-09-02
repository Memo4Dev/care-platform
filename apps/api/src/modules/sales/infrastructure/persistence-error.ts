import { PlatformError } from '@commerce-platform/contracts';

export function mapPersistenceError(error: unknown): unknown {
  const candidate = isRecord(error) ? error : null;
  const cause = candidate && isRecord(candidate.cause) ? candidate.cause : candidate;
  if (!cause || typeof cause.code !== 'string') return error;
  if (cause.code === '23503') {
    return PlatformError.validationFailed('Sale contains a reference outside its organization.', {
      details: { reference: String(cause.constraint ?? 'tenantReference') },
      cause: error,
    });
  }
  if (cause.code === '23505') {
    return PlatformError.validationFailed('Sale uniqueness invariant was violated.', {
      details: { constraint: String(cause.constraint ?? 'unique') },
      cause: error,
    });
  }
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
