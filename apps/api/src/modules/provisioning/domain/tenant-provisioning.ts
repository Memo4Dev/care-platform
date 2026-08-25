import type { TenantProvisioningStatus } from '@commerce-platform/database';

export const PROVISIONING_STEPS = [
  'CreatingOrganization',
  'CreatingIdentityDefaults',
  'CreatingBusinessDefaults',
  'CreatingStorefront',
] as const;
export type ProvisioningStep = (typeof PROVISIONING_STEPS)[number];
export type ProvisioningCheckpoints = Partial<
  Record<ProvisioningStep, { completedAt: string; skipped?: boolean }>
>;
export class TenantProvisioning {
  constructor(
    readonly id: string,
    readonly tenantId: string,
    readonly organizationId: string,
    private _status: TenantProvisioningStatus,
    private _currentStep: ProvisioningStep,
    private _checkpoints: ProvisioningCheckpoints,
    private _lastError: string | null,
    private _completedAt: Date | null,
    readonly version: number,
  ) {}
  get status() {
    return this._status;
  }
  get currentStep() {
    return this._currentStep;
  }
  get checkpoints() {
    return this._checkpoints;
  }
  get lastError() {
    return this._lastError;
  }
  get completedAt() {
    return this._completedAt;
  }
  isComplete(step: ProvisioningStep) {
    return !!this._checkpoints[step];
  }
  begin(step: ProvisioningStep) {
    this._status = statusFor(step);
    this._currentStep = step;
    this._lastError = null;
  }
  checkpoint(step: ProvisioningStep, skipped = false) {
    this._checkpoints = {
      ...this._checkpoints,
      [step]: { completedAt: new Date().toISOString(), ...(skipped ? { skipped: true } : {}) },
    };
  }
  fail(error: unknown) {
    this._status = 'FAILED';
    this._lastError =
      error instanceof Error ? error.message.slice(0, 4000) : String(error).slice(0, 4000);
  }
  complete() {
    this._status = 'COMPLETED';
    this._currentStep = 'CreatingStorefront';
    this._lastError = null;
    this._completedAt = new Date();
  }
}
function statusFor(step: ProvisioningStep): TenantProvisioningStatus {
  const statuses: Record<ProvisioningStep, TenantProvisioningStatus> = {
    CreatingOrganization: 'CREATING_ORGANIZATION',
    CreatingIdentityDefaults: 'CREATING_IDENTITY_DEFAULTS',
    CreatingBusinessDefaults: 'CREATING_BUSINESS_DEFAULTS',
    CreatingStorefront: 'CREATING_STOREFRONT',
  };
  return statuses[step];
}
