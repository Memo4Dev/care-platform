import { PlatformError } from '@commerce-platform/contracts';
import type { EntitlementValue } from '@commerce-platform/database';

import type { OverrideDomainEvent } from './events';
import { assertEntitlementValue } from './registry';

/** Aggregate for one explicit tenant override; revocation removes its active grant. */
export class TenantEntitlementOverride {
  private readonly events: OverrideDomainEvent[] = [];
  private constructor(
    readonly id: string,
    readonly organizationId: string,
    readonly code: string,
    readonly value: EntitlementValue,
    readonly effectiveFrom: Date,
    readonly effectiveTo: Date | null,
    readonly reason: string,
    readonly grantedBy: string,
    private pendingInsert: boolean,
    private pendingRevoke: boolean,
    private readonly clock: () => Date,
  ) {}
  static grant(
    input: {
      id: string;
      organizationId: string;
      code: string;
      value: EntitlementValue;
      effectiveFrom: Date;
      effectiveTo?: Date | null;
      reason: string;
      grantedBy: string;
    },
    options: OverrideOptions = {},
  ): TenantEntitlementOverride {
    nonEmpty(input.organizationId, 'organizationId');
    nonEmpty(input.code, 'code');
    nonEmpty(input.reason, 'reason');
    nonEmpty(input.grantedBy, 'grantedBy');
    assertEntitlementValue(input.code, input.value);
    const effectiveTo = input.effectiveTo ?? null;
    if (effectiveTo && effectiveTo <= input.effectiveFrom)
      throw PlatformError.validationFailed('effectiveTo must be after effectiveFrom.', {
        details: { field: 'effectiveTo' },
      });
    const override = new TenantEntitlementOverride(
      input.id,
      input.organizationId,
      input.code,
      input.value,
      input.effectiveFrom,
      effectiveTo,
      input.reason,
      input.grantedBy,
      true,
      false,
      options.clock ?? (() => new Date()),
    );
    override.events.push({
      type: 'TenantEntitlementOverrideGranted',
      occurredAt: override.clock(),
      overrideId: override.id,
      organizationId: override.organizationId,
      code: override.code,
    });
    return override;
  }
  static reconstitute(state: Omit<OverrideSnapshot, 'isRevoked'>, options: OverrideOptions = {}) {
    return new TenantEntitlementOverride(
      state.id,
      state.organizationId,
      state.code,
      state.value,
      state.effectiveFrom,
      state.effectiveTo,
      state.reason,
      state.grantedBy,
      false,
      false,
      options.clock ?? (() => new Date()),
    );
  }
  revoke(): void {
    if (this.pendingRevoke) throw PlatformError.validationFailed('Override is already revoked.');
    this.pendingRevoke = true;
    this.events.push({
      type: 'TenantEntitlementOverrideRevoked',
      occurredAt: this.clock(),
      overrideId: this.id,
      organizationId: this.organizationId,
      code: this.code,
    });
  }
  get hasPendingChanges() {
    return this.pendingInsert || this.pendingRevoke;
  }
  get isNew() {
    return this.pendingInsert;
  }
  get isRevoked() {
    return this.pendingRevoke;
  }
  pullDomainEvents() {
    return this.events.splice(0);
  }
  markPersisted() {
    this.pendingInsert = false;
    this.pendingRevoke = false;
  }
}
export interface OverrideSnapshot {
  id: string;
  organizationId: string;
  code: string;
  value: EntitlementValue;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  reason: string;
  grantedBy: string;
  isRevoked: boolean;
}
export interface OverrideOptions {
  clock?: () => Date;
}
function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw PlatformError.validationFailed(`${field} must be a non-empty string.`, {
      details: { field },
    });
  return value;
}
