import { describe, expect, it } from 'vitest';

import { assertSeparatedBearerAudiences } from './auth-config';

describe('bearer audience configuration', () => {
  it('accepts distinct platform and tenant audiences', () => {
    expect(() =>
      assertSeparatedBearerAudiences({
        SUPABASE_PLATFORM_AUDIENCE: 'platform-api',
        SUPABASE_TENANT_AUDIENCE: 'tenant-api',
      }),
    ).not.toThrow();
  });

  it('fails closed for missing or equal trust-domain audiences', () => {
    expect(() => assertSeparatedBearerAudiences({})).toThrow(
      'Platform and tenant bearer audiences must both be configured.',
    );
    expect(() =>
      assertSeparatedBearerAudiences({
        SUPABASE_PLATFORM_AUDIENCE: 'authenticated',
        SUPABASE_TENANT_AUDIENCE: 'authenticated',
      }),
    ).toThrow('Platform and tenant bearer audiences must be distinct.');
  });
});
