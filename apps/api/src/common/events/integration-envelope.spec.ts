import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';
import { assertIntegrationEventEnvelope } from './integration-envelope';

describe('integration event envelope scope validation', () => {
  it('rejects a tenant event without an organization ID and a global event with one', () => {
    for (const event of [
      { eventScope: 'TENANT', organizationId: null },
      { eventScope: 'GLOBAL', organizationId: 'org-1' },
    ]) {
      let error: unknown;
      try {
        assertIntegrationEventEnvelope(event);
      } catch (caught) {
        error = caught;
      }
      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    }
  });
});
