import { newId } from '@commerce-platform/database';

/**
 * Test-data factory conventions (docs/architecture/91-testing-architecture.md):
 *
 * - Factories build VALID domain state; tests override only what they assert on.
 * - IDs are passed in explicitly when a test needs deterministic/reproducible
 *   state (e.g. offline replay fixtures); otherwise they default to fresh
 *   UUIDv7 values.
 * - Tenant-owned shapes always carry `organizationId` so tenant-scoping bugs
 *   surface as assertion failures instead of silent cross-tenant reads.
 * - Avoid large shared fixtures: each test builds its own state via factories.
 */
export interface ExampleOrganizationScopedRow {
  id: string;
  organizationId: string;
  label: string;
  version: number;
}

/** Trivial example factory demonstrating the conventions above. */
export function exampleOrganizationScopedRow(
  overrides: Partial<ExampleOrganizationScopedRow> = {},
): ExampleOrganizationScopedRow {
  return {
    id: newId(),
    organizationId: newId(),
    label: 'example',
    version: 1,
    ...overrides,
  };
}
