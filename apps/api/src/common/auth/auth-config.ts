/**
 * Fail the API runtime closed when platform and tenant bearer domains are not
 * independently configured. Equal audiences would let one JWT satisfy both
 * guards whenever its subject is mapped in both principal stores.
 */
export function assertSeparatedBearerAudiences(environment: NodeJS.ProcessEnv = process.env): void {
  const platformAudience = environment.SUPABASE_PLATFORM_AUDIENCE?.trim();
  const tenantAudience = environment.SUPABASE_TENANT_AUDIENCE?.trim();

  if (!platformAudience || !tenantAudience) {
    throw new Error('Platform and tenant bearer audiences must both be configured.');
  }
  if (platformAudience === tenantAudience) {
    throw new Error('Platform and tenant bearer audiences must be distinct.');
  }
}
