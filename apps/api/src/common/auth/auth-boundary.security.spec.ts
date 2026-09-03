import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  platformPrincipals,
  platformTenants,
  users,
  type DatabaseClient,
} from '@commerce-platform/database';
import { ERROR_CODES } from '@commerce-platform/contracts';
import type { ExecutionContext } from '@nestjs/common';

import {
  assertTrustedOrganizationUserPrincipal,
  assertTrustedPrincipal,
  type OrganizationUserPrincipal,
  type PlatformUserPrincipal,
} from './authenticated-principal';
import {
  PlatformBearerGuard,
  TenantBearerGuard,
  type AuthenticatedRequest,
} from './http-auth.guards';
import { SupabaseJwtService } from './supabase-jwt.service';
import { DatabasePlatformPrincipalResolver } from '../../modules/platform/application/authenticated-principal.provider';

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * ADR-0011 security boundary spec.
 *
 * The Supabase JWT `aud` identifies the token's intended API audience only and
 * is NOT the Platform/Tenant authorization boundary. Platform vs Tenant
 * separation is enforced server-side after Supabase identity verification by
 * the principal resolvers (platform.principals) and TenantBearerGuard
 * (identity.users + tenant lifecycle). A valid Supabase token alone must never
 * grant Platform (or tenant) access, and caller-injected claims must never
 * bypass server-side authorization.
 *
 * These tests exercise the real SupabaseJwtService (ES256 signature verified
 * against a stubbed JWKS endpoint), the real guards, and the real
 * DatabasePlatformPrincipalResolver. Only the DATABASE is emulated: an
 * in-memory fake that emulates the drizzle lookups by extracting the bound
 * parameters from the `eq()`/`and()` conditions, so the resolvers' subject and
 * status filters are genuinely applied.
 */
describe('Authentication audience is NOT the Platform/Tenant authorization boundary (ADR-0011)', () => {
  const ISSUER = 'https://auth.example.test';
  const JWKS_URL = 'https://auth.example.test/jwks';
  const PLATFORM_AUDIENCE = 'platform';
  const TENANT_AUDIENCE = 'tenant';
  const KEY_ID = 'k1';

  let privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
  let publicKey: ReturnType<typeof generateKeyPairSync>['publicKey'];

  beforeEach(() => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
    process.env.SUPABASE_JWT_ISSUER = ISSUER;
    process.env.SUPABASE_JWKS_URL = JWKS_URL;
    process.env.SUPABASE_PLATFORM_AUDIENCE = PLATFORM_AUDIENCE;
    process.env.SUPABASE_TENANT_AUDIENCE = TENANT_AUDIENCE;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KEY_ID }] }),
          ),
      ),
    );
  });

  it('1. verifies a valid Supabase JWT (signature, issuer, exp, aud) to a subject before any authorization', async () => {
    const state = platformState({
      principalsBySubject: new Map([
        ['platform-owner-1', { id: 'platform-user-1', status: 'ACTIVE' }],
      ]),
    });
    const jwt = new SupabaseJwtService();
    const guard = new PlatformBearerGuard(jwt, new DatabasePlatformPrincipalResolver(state.client));
    const verify = vi.spyOn(jwt, 'verify');
    const request: AuthenticatedRequest = { headers: {} };
    const context = executionContext(request);

    const tokenText = token(privateKey, {
      sub: 'platform-owner-1',
      iss: ISSUER,
      aud: PLATFORM_AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    request.headers.authorization = `Bearer ${tokenText}`;

    await expect(guard.canActivate(context)).resolves.toBe(true);

    // The raw bearer token and the configured platform audience reached the
    // verifier; the signature/issuer/exp/aud checks passed (any failure would
    // have thrown INVALID_CREDENTIALS before the resolver ran).
    expect(verify).toHaveBeenCalledWith(tokenText, PLATFORM_AUDIENCE);
    // Only one server-side lookup happened: the platform principal assignment.
    expect(state.calls).toEqual(['platformPrincipals:platform-owner-1']);
    expect(request.principal).toMatchObject({
      type: 'PLATFORM_USER',
      subjectId: 'platform-owner-1',
      platformUserId: 'platform-user-1',
    });
    expect(() => assertTrustedPrincipal(request.principal)).not.toThrow();
  });

  it('2. a valid JWT alone does not grant a Platform principal: missing platform.principals row is the rejection, not the token', async () => {
    const state = platformState({ principalsBySubject: new Map() });
    const jwt = new SupabaseJwtService();
    const guard = new PlatformBearerGuard(jwt, new DatabasePlatformPrincipalResolver(state.client));
    const verify = vi.spyOn(jwt, 'verify');
    const request: AuthenticatedRequest = { headers: {} };
    const context = executionContext(request);

    request.headers.authorization = `Bearer ${token(privateKey, {
      sub: 'unassigned-subject',
      iss: ISSUER,
      aud: PLATFORM_AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 60,
    })}`;

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
    });

    // The token was cryptographically valid and its audience was accepted; the
    // rejection came from the server-side principal resolver because no
    // platform.principals row exists for the verified subject.
    expect(verify).toHaveBeenCalledTimes(1);
    expect(state.calls).toEqual(['platformPrincipals:unassigned-subject']);
    expect(request.principal).toBeUndefined();
  });

  it('3. a valid JWT with an ACTIVE platform principal row is allowed as PLATFORM_USER; a non-ACTIVE row is rejected', async () => {
    const state = platformState({
      principalsBySubject: new Map([
        ['platform-owner-1', { id: 'platform-user-1', status: 'ACTIVE' }],
      ]),
    });
    const jwt = new SupabaseJwtService();
    const guard = new PlatformBearerGuard(jwt, new DatabasePlatformPrincipalResolver(state.client));
    const request: AuthenticatedRequest = { headers: {} };
    const context = executionContext(request);

    request.headers.authorization = `Bearer ${platformToken('platform-owner-1')}`;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.principal).toMatchObject({
      type: 'PLATFORM_USER',
      subjectId: 'platform-owner-1',
      platformUserId: 'platform-user-1',
    } satisfies Partial<PlatformUserPrincipal>);

    // Same subject, but the server-side row is not ACTIVE: the SQL filter
    // (status = 'ACTIVE') finds no principal and the resolver denies. The JWT
    // is identical in form — server-side assignment decides.
    const suspended = platformState({
      principalsBySubject: new Map([
        ['platform-owner-1', { id: 'platform-user-1', status: 'SUSPENDED' }],
      ]),
    });
    const suspendedGuard = new PlatformBearerGuard(
      jwt,
      new DatabasePlatformPrincipalResolver(suspended.client),
    );
    const suspendedRequest: AuthenticatedRequest = { headers: {} };
    suspendedRequest.headers.authorization = `Bearer ${platformToken('platform-owner-1')}`;
    await expect(
      suspendedGuard.canActivate(executionContext(suspendedRequest)),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
    });
    expect(suspendedRequest.principal).toBeUndefined();
  });

  it('4. an organization user cannot reach platform endpoints without a platform principal, and a platform user cannot reach tenant endpoints without tenant membership', async () => {
    // A valid tenant user (identity.users + completed tenant) carries a token
    // whose aud includes BOTH audiences — as real Supabase user tokens do. The
    // platform endpoint still rejects because the subject has no
    // platform.principals row. The audience is not the boundary.
    const tenantState = platformState({
      principalsBySubject: new Map(),
      usersBySubject: new Map([
        ['org-user-1', { id: 'user-1', organizationId: 'org-a', status: 'ACTIVE' }],
      ]),
      tenantsByOrg: new Map([['org-a', { status: 'ACTIVE', provisioningStatus: 'COMPLETED' }]]),
    });
    const tenantJwt = new SupabaseJwtService();
    const platformGuard = new PlatformBearerGuard(
      tenantJwt,
      new DatabasePlatformPrincipalResolver(tenantState.client),
    );
    const platformRequest: AuthenticatedRequest = { headers: {} };
    platformRequest.headers.authorization = `Bearer ${token(privateKey, {
      sub: 'org-user-1',
      iss: ISSUER,
      aud: [TENANT_AUDIENCE, PLATFORM_AUDIENCE],
      exp: Math.floor(Date.now() / 1000) + 60,
    })}`;
    await expect(
      platformGuard.canActivate(executionContext(platformRequest)),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
    });
    expect(platformRequest.principal).toBeUndefined();

    // A token that omits the platform audience entirely is rejected at
    // verification (INVALID_CREDENTIALS) before any resolver runs: `aud` still
    // gates which API audience the token was minted for.
    const wrongAudienceRequest: AuthenticatedRequest = { headers: {} };
    wrongAudienceRequest.headers.authorization = `Bearer ${token(privateKey, {
      sub: 'org-user-1',
      iss: ISSUER,
      aud: TENANT_AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 60,
    })}`;
    await expect(
      platformGuard.canActivate(executionContext(wrongAudienceRequest)),
    ).rejects.toMatchObject({ code: ERROR_CODES.INVALID_CREDENTIALS });

    // Conversely: a platform principal (platform.principals row exists) has no
    // identity.users membership, so the tenant endpoint rejects. Platform
    // assignment does not imply tenant access.
    const platformOnlyState = platformState({
      principalsBySubject: new Map([
        ['platform-owner-1', { id: 'platform-user-1', status: 'ACTIVE' }],
      ]),
      usersBySubject: new Map(),
      tenantsByOrg: new Map(),
    });
    const tenantGuard = new TenantBearerGuard(platformOnlyState.jwt(), platformOnlyState.client);
    const tenantRequest: AuthenticatedRequest = { headers: {} };
    tenantRequest.headers.authorization = `Bearer ${token(privateKey, {
      sub: 'platform-owner-1',
      iss: ISSUER,
      aud: TENANT_AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 60,
    })}`;
    await expect(tenantGuard.canActivate(executionContext(tenantRequest))).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
    });
    expect(tenantRequest.principal).toBeUndefined();
  });

  it('5. caller-injected role/permission/organizationId claims do not bypass server-side authorization', async () => {
    // Platform side: the token claims a platform role and capabilities, but the
    // verified subject has no platform.principals row — denial, claims ignored.
    const state = platformState({ principalsBySubject: new Map() });
    const jwt = state.jwt();
    const guard = new PlatformBearerGuard(jwt, new DatabasePlatformPrincipalResolver(state.client));
    const request: AuthenticatedRequest = { headers: {} };
    request.headers.authorization = `Bearer ${token(privateKey, {
      sub: 'claim-forger',
      iss: ISSUER,
      aud: PLATFORM_AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 60,
      role: 'PLATFORM_OWNER',
      capabilities: ['tenant.suspend', 'platform.audit', 'support.session'],
      organizationId: 'org-victim',
      organizationUserId: 'forged-user-id',
    })}`;
    await expect(guard.canActivate(executionContext(request))).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
    });
    expect(state.calls).toEqual(['platformPrincipals:claim-forger']);

    // Tenant side: the token claims OWNER plus sales.create for a victim
    // organization, but the verified subject is not an ACTIVE identity.users
    // row — denial, claims ignored.
    const noUserState = platformState({
      principalsBySubject: new Map(),
      usersBySubject: new Map(),
      tenantsByOrg: new Map(),
    });
    const noUserGuard = new TenantBearerGuard(noUserState.jwt(), noUserState.client);
    const forgerRequest: AuthenticatedRequest = { headers: {} };
    forgerRequest.headers.authorization = `Bearer ${token(privateKey, {
      sub: 'claim-forger',
      iss: ISSUER,
      aud: TENANT_AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 60,
      role: 'OWNER',
      permissions: ['sales.create', 'price.override'],
      organizationId: 'org-victim',
    })}`;
    await expect(noUserGuard.canActivate(executionContext(forgerRequest))).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
    });

    // Control: a genuine ACTIVE membership is still resolved from the
    // server-side row only — even when the token claims a different
    // organizationId, the principal carries the server-derived organization.
    const realUserState = platformState({
      principalsBySubject: new Map(),
      usersBySubject: new Map([
        ['tenant-user-1', { id: 'user-1', organizationId: 'org-a', status: 'ACTIVE' }],
      ]),
      tenantsByOrg: new Map([['org-a', { status: 'ACTIVE', provisioningStatus: 'COMPLETED' }]]),
    });
    const realUserGuard = new TenantBearerGuard(realUserState.jwt(), realUserState.client);
    const realUserRequest: AuthenticatedRequest = { headers: {} };
    realUserRequest.headers.authorization = `Bearer ${token(privateKey, {
      sub: 'tenant-user-1',
      iss: ISSUER,
      aud: TENANT_AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 60,
      role: 'OWNER',
      permissions: ['sales.create'],
      organizationId: 'org-victim',
    })}`;
    await expect(realUserGuard.canActivate(executionContext(realUserRequest))).resolves.toBe(true);
    expect(realUserRequest.principal).toMatchObject({
      type: 'ORGANIZATION_USER',
      subjectId: 'tenant-user-1',
      organizationUserId: 'user-1',
      organizationId: 'org-a',
    } satisfies Partial<OrganizationUserPrincipal>);
  });

  it('6. a tenant user with ACTIVE status and a COMPLETED/ACTIVE tenant resolves as ORGANIZATION_USER with server-derived organizationId', async () => {
    const state = platformState({
      principalsBySubject: new Map(),
      usersBySubject: new Map([
        ['tenant-user-1', { id: 'user-1', organizationId: 'org-a', status: 'ACTIVE' }],
      ]),
      tenantsByOrg: new Map([['org-a', { status: 'ACTIVE', provisioningStatus: 'COMPLETED' }]]),
    });
    const guard = new TenantBearerGuard(state.jwt(), state.client);
    const request: AuthenticatedRequest = { headers: {} };
    request.headers.authorization = `Bearer ${token(privateKey, {
      sub: 'tenant-user-1',
      iss: ISSUER,
      aud: TENANT_AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 60,
    })}`;

    await expect(guard.canActivate(executionContext(request))).resolves.toBe(true);

    expect(state.calls).toEqual(['users:tenant-user-1', 'platformTenants:org-a']);
    expect(request.principal).toMatchObject({
      type: 'ORGANIZATION_USER',
      subjectId: 'tenant-user-1',
      organizationUserId: 'user-1',
      organizationId: 'org-a',
    } satisfies Partial<OrganizationUserPrincipal>);
    expect(() => assertTrustedOrganizationUserPrincipal(request.principal)).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Fixtures
  // -------------------------------------------------------------------------

  interface PrincipalSeed {
    id: string;
    status: string;
  }
  interface UserSeed {
    id: string;
    organizationId: string;
    status: string;
  }
  interface TenantSeed {
    status: string;
    provisioningStatus: string;
  }
  interface PlatformState {
    principalsBySubject: Map<string, PrincipalSeed>;
    usersBySubject?: Map<string, UserSeed>;
    tenantsByOrg?: Map<string, TenantSeed>;
  }

  function platformState(state: PlatformState) {
    const calls: string[] = [];
    let jwtService: SupabaseJwtService | undefined;
    return {
      calls,
      client: fakeDatabase(
        {
          principalsBySubject: state.principalsBySubject,
          usersBySubject: state.usersBySubject ?? new Map(),
          tenantsByOrg: state.tenantsByOrg ?? new Map(),
        },
        calls,
      ),
      jwt: () => (jwtService ??= new SupabaseJwtService()),
    };
  }

  /** Light in-memory DATABASE that emulates the drizzle lookup chains the auth
   * guards and resolvers execute, applying the bound `eq()`/`and()` conditions. */
  function fakeDatabase(
    state: {
      principalsBySubject: Map<string, PrincipalSeed>;
      usersBySubject: Map<string, UserSeed>;
      tenantsByOrg: Map<string, TenantSeed>;
    },
    calls: string[],
  ): DatabaseClient {
    const lookup = (table: unknown, condition: unknown): Array<Record<string, unknown>> => {
      const where = conditionsOf(condition);
      if (where.size === 0) {
        throw new Error('FakeDatabase: could not extract bound conditions from query.');
      }
      if (table === platformPrincipals) {
        const subject = where.get(platformPrincipals.supabaseUserId);
        calls.push(`platformPrincipals:${String(subject)}`);
        const row = state.principalsBySubject.get(String(subject));
        if (!row) return [];
        const expectedStatus = where.get(platformPrincipals.status);
        if (expectedStatus !== undefined && row.status !== expectedStatus) return [];
        return [{ id: row.id }];
      }
      if (table === users) {
        const subject = where.get(users.supabaseUserId);
        calls.push(`users:${String(subject)}`);
        const row = state.usersBySubject.get(String(subject));
        if (!row) return [];
        const expectedStatus = where.get(users.status);
        if (expectedStatus !== undefined && row.status !== expectedStatus) return [];
        return [{ id: row.id, organizationId: row.organizationId, status: row.status }];
      }
      if (table === platformTenants) {
        const organizationId = where.get(platformTenants.organizationId);
        calls.push(`platformTenants:${String(organizationId)}`);
        const row = state.tenantsByOrg.get(String(organizationId));
        if (!row) return [];
        const expectedStatus = where.get(platformTenants.status);
        if (expectedStatus !== undefined && row.status !== expectedStatus) return [];
        const expectedProvisioning = where.get(platformTenants.provisioningStatus);
        if (expectedProvisioning !== undefined && row.provisioningStatus !== expectedProvisioning) {
          return [];
        }
        return [{ status: row.status, provisioningStatus: row.provisioningStatus }];
      }
      throw new Error(`FakeDatabase: unexpected table ${String(table)}`);
    };

    return {
      select: () => ({
        from: (table: unknown) => ({
          where: (condition: unknown) => ({ limit: async () => lookup(table, condition) }),
        }),
      }),
    } as unknown as DatabaseClient;
  }

  /** Extracts `column → bound value` pairs from a drizzle `eq()`/`and()`
   * condition by walking its `queryChunks` (Param chunks carry the values;
   * column operands are the schema column objects themselves). */
  function conditionsOf(condition: unknown): Map<object, unknown> {
    const pairs: Array<{ column: object; value: unknown }> = [];
    let column: object | null = null;
    let value: unknown;
    const flush = () => {
      if (column) pairs.push({ column, value });
      column = null;
      value = undefined;
    };
    const visit = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const candidate = node as { queryChunks?: unknown[] };
      if (!Array.isArray(candidate.queryChunks)) return;
      for (const chunk of candidate.queryChunks) {
        if (!chunk || typeof chunk !== 'object') continue;
        const c = chunk as { queryChunks?: unknown[]; value?: unknown };
        if (Array.isArray(c.queryChunks)) {
          visit(chunk);
        } else if (Array.isArray(c.value)) {
          // Operator/whitespace StringChunk — separate on ' and ' / ','.
          const text = String((c.value as unknown[])[0] ?? '');
          if (text.trim() === 'and' || text.trim() === ',') flush();
        } else if ('value' in c) {
          value = c.value; // Param
        } else {
          column = chunk as object; // column operand
        }
      }
    };
    visit(condition);
    flush();
    const result = new Map<object, unknown>();
    for (const pair of pairs) result.set(pair.column, pair.value);
    return result;
  }

  function platformToken(subject: string): string {
    return token(privateKey, {
      sub: subject,
      iss: ISSUER,
      aud: PLATFORM_AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 60,
    });
  }
});

function executionContext(request: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function token(privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], claims: object) {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'k1', typ: 'JWT' })).toString(
    'base64url',
  );
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `${header}.${payload}.${signature}`;
}
