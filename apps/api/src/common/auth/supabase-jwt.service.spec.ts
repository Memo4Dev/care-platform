import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SupabaseJwtService } from './supabase-jwt.service';

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
  vi.unstubAllGlobals();
});

describe('SupabaseJwtService', () => {
  it('accepts a valid ES256 IEEE-P1363 JWT and rejects wrong issuer, audiences and expiry', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    process.env.SUPABASE_JWKS_URL = 'https://auth.example.test/jwks';
    process.env.SUPABASE_JWT_ISSUER = 'https://auth.example.test';
    process.env.SUPABASE_PLATFORM_AUDIENCE = 'platform';
    process.env.SUPABASE_TENANT_AUDIENCE = 'tenant';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1' }] }),
          ),
      ),
    );
    const service = new SupabaseJwtService();
    await expect(
      service.verify(
        token(privateKey, {
          sub: 'subject',
          iss: 'https://auth.example.test',
          aud: 'tenant',
          exp: Math.floor(Date.now() / 1000) + 60,
        }),
        'tenant',
      ),
    ).resolves.toBe('subject');
    // The JWT audience identifies the token's intended API audience and is NOT
    // the Platform/Tenant authorization boundary. A token that carries the
    // expected audience alongside another domain is still accepted here; the
    // Platform/Tenant separation is enforced server-side by the principal
    // resolvers after identity verification (see ADR-0011).
    await expect(
      service.verify(
        token(privateKey, {
          sub: 'subject',
          iss: 'https://auth.example.test',
          aud: ['tenant', 'platform'],
          exp: Math.floor(Date.now() / 1000) + 60,
        }),
        'tenant',
      ),
    ).resolves.toBe('subject');
    await expect(
      service.verify(
        token(privateKey, {
          sub: 'subject',
          iss: 'https://auth.example.test',
          aud: ['tenant', 'supplemental-service'],
          exp: Math.floor(Date.now() / 1000) + 60,
        }),
        'tenant',
      ),
    ).resolves.toBe('subject');
    await expect(
      service.verify(
        token(privateKey, {
          sub: 'subject',
          iss: 'https://auth.example.test',
          aud: 'platform',
          exp: Math.floor(Date.now() / 1000) + 60,
        }),
        'tenant',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(
      service.verify(
        token(privateKey, {
          sub: 'subject',
          iss: 'https://other.example.test',
          aud: 'tenant',
          exp: Math.floor(Date.now() / 1000) + 60,
        }),
        'tenant',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(
      service.verify(
        token(privateKey, {
          sub: 'subject',
          iss: 'https://auth.example.test',
          aud: 'tenant',
          exp: Math.floor(Date.now() / 1000) - 1,
        }),
        'tenant',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('rejects unsigned, malformed, tampered and multi-segment tokens', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    process.env.SUPABASE_JWKS_URL = 'https://auth.example.test/jwks';
    process.env.SUPABASE_JWT_ISSUER = 'https://auth.example.test';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1' }] }),
          ),
      ),
    );
    const service = new SupabaseJwtService();
    const claims = {
      sub: 'subject',
      iss: 'https://auth.example.test',
      aud: 'tenant',
      exp: Math.floor(Date.now() / 1000) + 60,
    };
    const valid = token(privateKey, claims);
    const [header, payload, signature] = valid.split('.');

    // Unsigned: only two dot-separated parts.
    await expect(service.verify(`${header}.${payload}`, 'tenant')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    // Malformed: not three dot-separated parts, empty, or garbage.
    await expect(service.verify('not-a-jwt', 'tenant')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    await expect(service.verify('', 'tenant')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    // Extra segments beyond header.payload.signature.
    await expect(service.verify(`${valid}.extra`, 'tenant')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    // Tampered: payload swapped (attacker subject + injected role claim) while
    // the original signature is kept — the signature no longer matches.
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...claims, sub: 'attacker', role: 'PLATFORM_OWNER' }),
    ).toString('base64url');
    await expect(
      service.verify(`${header}.${forgedPayload}.${signature}`, 'tenant'),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    // Corrupted signature bytes.
    await expect(service.verify(`${header}.${payload}.bogus`, 'tenant')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });
});
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
