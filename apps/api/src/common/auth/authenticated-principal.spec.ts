import { describe, expect, it } from 'vitest';

import {
  assertTrustedOrganizationUserPrincipal,
  trustPrincipal,
  type OrganizationUserPrincipal,
  type PlatformUserPrincipal,
} from './authenticated-principal';

describe('assertTrustedOrganizationUserPrincipal', () => {
  it('accepts a trusted organization-user principal', () => {
    const principal = trustPrincipal({
      type: 'ORGANIZATION_USER',
      subjectId: 'subject-1',
      organizationUserId: 'user-1',
      organizationId: 'organization-1',
    } as OrganizationUserPrincipal);

    expect(() => assertTrustedOrganizationUserPrincipal(principal)).not.toThrow();
  });

  it('rejects an untrusted object with the correct structural shape', () => {
    const principal = {
      type: 'ORGANIZATION_USER',
      subjectId: 'subject-1',
      organizationUserId: 'user-1',
      organizationId: 'organization-1',
    };

    expect(() => assertTrustedOrganizationUserPrincipal(principal)).toThrow(
      'Trusted authenticated principal required.',
    );
  });

  it('rejects a trusted principal of another type', () => {
    const principal = trustPrincipal({
      type: 'PLATFORM_USER',
      subjectId: 'subject-1',
      platformUserId: 'platform-user-1',
    } as PlatformUserPrincipal);

    expect(() => assertTrustedOrganizationUserPrincipal(principal)).toThrow(
      'Trusted organization-user principal required.',
    );
  });

  it('rejects a trusted organization-user principal with incomplete identifiers', () => {
    const principal = trustPrincipal({
      type: 'ORGANIZATION_USER',
      subjectId: 'subject-1',
      organizationUserId: '',
      organizationId: 'organization-1',
    } as OrganizationUserPrincipal);

    expect(() => assertTrustedOrganizationUserPrincipal(principal)).toThrow(
      'Trusted organization-user principal required.',
    );
  });
});
