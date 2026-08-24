import { PlatformError } from '@commerce-platform/contracts';

/**
 * Storage-level unique-violation mapping for the Identity context, mirroring
 * the Organization context's contract: 23505 on business keys becomes
 * VALIDATION_FAILED (422) with the constraint name preserved in `details`;
 * everything else is returned untouched so unexpected driver failures are
 * never disguised as domain errors.
 */

interface PersistenceErrorContext {
  table: string;
  organizationId: string;
  resourceId?: string;
}

/** Minimal PG error surface used for mapping (see organization repository). */
interface PgLikeError {
  code?: unknown;
  constraint?: unknown;
  cause?: unknown;
}

export function mapPersistenceError(error: unknown, context: PersistenceErrorContext): unknown {
  // Drizzle wraps node-postgres constraint errors in DrizzleQueryError. Keep
  // the driver error as the cause but inspect it so normal business-key
  // violations still receive the stable platform error contract.
  const wrapped = error as PgLikeError | null;
  const candidate =
    wrapped && typeof wrapped === 'object' && wrapped.cause && typeof wrapped.cause === 'object'
      ? (wrapped.cause as PgLikeError)
      : wrapped;
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    candidate.code !== '23505' || // unique_violation
    typeof candidate.constraint !== 'string'
  ) {
    return error;
  }

  const fieldByConstraint: Record<string, string> = {
    users_email_unique: 'email',
    users_email_lower_unique: 'email',
    users_supabase_user_id_unique: 'supabaseUserId',
    roles_org_code_unique: 'code',
    permissions_code_unique: 'code',
  };

  const field = fieldByConstraint[candidate.constraint] ?? 'constraint';
  return PlatformError.validationFailed(
    `${context.table} constraint ${candidate.constraint} violated.`,
    {
      details: {
        constraint: candidate.constraint,
        field,
        table: context.table,
        organizationId: context.organizationId,
        ...(context.resourceId === undefined ? {} : { resourceId: context.resourceId }),
      },
      cause: error,
    },
  );
}
