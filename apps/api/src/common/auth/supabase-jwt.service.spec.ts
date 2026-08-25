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
