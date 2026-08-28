import { createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PlatformError } from '@commerce-platform/contracts';

interface JwtHeader {
  alg?: string;
  kid?: string;
}
interface JwtClaims {
  sub?: string;
  aud?: string | string[];
  exp?: number;
  iss?: string;
}
interface Jwk {
  kid?: string;
  kty: string;
  [key: string]: unknown;
}

/** Verifies Supabase bearer JWT signatures before any subject is resolved. */
@Injectable()
export class SupabaseJwtService {
  private jwks?: { expiresAt: number; keys: Jwk[] };

  async verify(token: string, audience: string): Promise<string> {
    const [encodedHeader, encodedPayload, encodedSignature, ...extra] = token.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature || extra.length) throw invalid();
    const header = decode<JwtHeader>(encodedHeader);
    const claims = decode<JwtClaims>(encodedPayload);
    const issuer = process.env.SUPABASE_JWT_ISSUER;
    if (
      !header ||
      !claims ||
      !claims.sub ||
      !issuer ||
      claims.iss !== issuer ||
      !this.matchesAudience(claims.aud, audience)
    )
      throw invalid();
    if (!Number.isFinite(claims.exp) || (claims.exp as number) <= Math.floor(Date.now() / 1000))
      throw invalid();
    const input = `${encodedHeader}.${encodedPayload}`;
    const signature = Buffer.from(encodedSignature, 'base64url');
    if (header.alg === 'HS256') {
      const secret = process.env.SUPABASE_JWT_SECRET;
      if (!secret) throw invalid();
      const expected = createHmac('sha256', secret).update(input).digest();
      if (signature.length !== expected.length || !timingSafeEqual(signature, expected))
        throw invalid();
    } else if (header.alg === 'RS256' || header.alg === 'ES256') {
      const key = await this.jwk(header.kid);
      const algorithm = header.alg === 'RS256' ? 'RSA-SHA256' : 'sha256';
      if (
        !verify(
          algorithm,
          Buffer.from(input),
          {
            key: createPublicKey({ key, format: 'jwk' }),
            ...(header.alg === 'ES256' ? { dsaEncoding: 'ieee-p1363' as const } : {}),
          },
          signature,
        )
      )
        throw invalid();
    } else throw invalid();
    return claims.sub;
  }
  private matchesAudience(actual: JwtClaims['aud'], expected: string) {
    const platformAudience = process.env.SUPABASE_PLATFORM_AUDIENCE?.trim();
    const tenantAudience = process.env.SUPABASE_TENANT_AUDIENCE?.trim();
    if (
      !platformAudience ||
      !tenantAudience ||
      platformAudience === tenantAudience ||
      (expected !== platformAudience && expected !== tenantAudience)
    )
      return false;

    const audiences = typeof actual === 'string' ? [actual] : actual;
    if (!audiences?.includes(expected)) return false;

    // A signed token must still identify one unambiguous application trust
    // domain. Supabase permits aud arrays, but a token carrying both configured
    // domains must never satisfy both the platform and tenant guards.
    return !(audiences.includes(platformAudience) && audiences.includes(tenantAudience));
  }
  private async jwk(kid?: string): Promise<Jwk> {
    const url = process.env.SUPABASE_JWKS_URL;
    if (!url || !kid) throw invalid();
    if (!this.jwks || this.jwks.expiresAt < Date.now()) {
      const response = await fetch(url);
      if (!response.ok) throw invalid();
      const body = (await response.json()) as { keys?: Jwk[] };
      this.jwks = { keys: body.keys ?? [], expiresAt: Date.now() + 300_000 };
    }
    const key = this.jwks.keys.find((candidate) => candidate.kid === kid);
    if (!key) throw invalid();
    return key;
  }
}
function decode<T>(part: string): T | null {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}
function invalid(): PlatformError {
  return PlatformError.invalidCredentials('Invalid Supabase access token.');
}
