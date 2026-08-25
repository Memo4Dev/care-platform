export type PrincipalType =
  'PLATFORM_USER' | 'ORGANIZATION_USER' | 'ONLINE_CUSTOMER' | 'POS_DEVICE' | 'SYSTEM_SERVICE';
declare const opaquePrincipal: unique symbol;
export interface AuthenticatedPrincipal {
  readonly type: PrincipalType;
  readonly subjectId: string;
  readonly [opaquePrincipal]: never;
}
export interface PlatformUserPrincipal extends AuthenticatedPrincipal {
  readonly type: 'PLATFORM_USER';
  readonly platformUserId: string;
}
export interface SystemServicePrincipal extends AuthenticatedPrincipal {
  readonly type: 'SYSTEM_SERVICE';
}
