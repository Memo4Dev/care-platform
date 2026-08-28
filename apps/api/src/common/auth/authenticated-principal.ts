export type PrincipalType =
  'PLATFORM_USER' | 'ORGANIZATION_USER' | 'ONLINE_CUSTOMER' | 'POS_DEVICE' | 'SYSTEM_SERVICE';
declare const opaquePrincipal: unique symbol;
export interface AuthenticatedPrincipal {
  readonly type: PrincipalType;
  readonly subjectId: string;
  readonly [opaquePrincipal]: never;
}
const trustedPrincipals = new WeakSet<object>();
export function trustPrincipal<T extends AuthenticatedPrincipal>(principal: T): T {
  trustedPrincipals.add(principal);
  return Object.freeze(principal);
}
export function assertTrustedPrincipal(value: unknown): asserts value is AuthenticatedPrincipal {
  if (!value || typeof value !== 'object' || !trustedPrincipals.has(value)) {
    throw new Error('Trusted authenticated principal required.');
  }
}
export function assertTrustedOrganizationUserPrincipal(
  value: unknown,
): asserts value is OrganizationUserPrincipal {
  assertTrustedPrincipal(value);
  if (
    value.type !== 'ORGANIZATION_USER' ||
    typeof value.subjectId !== 'string' ||
    value.subjectId.length === 0 ||
    !('organizationUserId' in value) ||
    typeof value.organizationUserId !== 'string' ||
    value.organizationUserId.length === 0 ||
    !('organizationId' in value) ||
    typeof value.organizationId !== 'string' ||
    value.organizationId.length === 0
  ) {
    throw new Error('Trusted organization-user principal required.');
  }
}
export interface PlatformUserPrincipal extends AuthenticatedPrincipal {
  readonly type: 'PLATFORM_USER';
  readonly platformUserId: string;
}
export interface OrganizationUserPrincipal extends AuthenticatedPrincipal {
  readonly type: 'ORGANIZATION_USER';
  readonly organizationUserId: string;
  readonly organizationId: string;
}
export interface SystemServicePrincipal extends AuthenticatedPrincipal {
  readonly type: 'SYSTEM_SERVICE';
}
