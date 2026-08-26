/**
 * Nest injection token for the shared PostgreSQL database handle
 * (`DatabaseClient` from `@commerce-platform/database`).
 *
 * Kept in its own module so context modules can reference the token (for
 * `@Inject(DATABASE)`) without importing the database module itself.
 */
export const DATABASE = Symbol('DATABASE');
