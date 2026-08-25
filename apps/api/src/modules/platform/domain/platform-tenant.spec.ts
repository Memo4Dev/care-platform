import { ERROR_CODES } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';
import { PlatformTenant } from './platform-tenant';

const now = new Date('2026-01-01T00:00:00.000Z');
const tenant = () =>
  PlatformTenant.register({ id: 'tenant-1', organizationId: 'org-1' }, { clock: () => now });
describe('PlatformTenant', () => {
  it('given a registered provisioned tenant when activated, suspended, reactivated and closed then it emits the lifecycle', () => {
    const subject = tenant();
    subject.completeProvisioning();
    subject.activate();
    subject.suspend('Billing review');
    subject.reactivate();
    subject.close();
    expect(subject.status).toBe('CLOSED');
    expect(subject.pullDomainEvents().map((e) => e.type)).toEqual([
      'TenantRegistered',
      'TenantActivated',
      'TenantSuspended',
      'TenantReactivated',
      'TenantClosed',
    ]);
  });
  it('given incomplete provisioning when activated then it is rejected', () => {
    expect.assertions(1);
    const subject = PlatformTenant.register(
      { id: 'tenant-1', organizationId: 'org-1' },
      { clock: () => now },
    );
    try {
      subject.activate();
    } catch (error) {
      expect(error).toMatchObject({ code: ERROR_CODES.TENANT_PROVISIONING_INCOMPLETE });
    }
  });
  it('given support access when requested and started then it is explicit and expired sessions cannot start', () => {
    const subject = tenant();
    subject.requestSupport({
      id: 'session-1',
      reason: 'Investigate ticket',
      requestedByPlatformUserId: 'operator-1',
      expiresAt: new Date('2026-01-01T01:00:00.000Z'),
    });
    subject.startSupport('session-1', 'operator-1');
    expect(subject.sessions[0]).toMatchObject({
      status: 'ACTIVE',
      requestedByPlatformUserId: 'operator-1',
      startedByPlatformUserId: 'operator-1',
      reason: 'Investigate ticket',
    });
    const expired = PlatformTenant.reconstitute(
      {
        id: subject.id,
        organizationId: subject.organizationId,
        status: subject.status,
        provisioningStatus: subject.provisioningStatus,
        subscriptionId: null,
        subscriptionVersion: null,
        suspendedReason: null,
        version: subject.version,
        sessions: subject.sessions,
      },
      { clock: () => new Date('2026-01-01T02:00:00.000Z') },
    );
    expired.expireSupportSessions();
    expect(expired.sessions[0]).toMatchObject({ status: 'EXPIRED', endReason: 'expired' });
  });
});
