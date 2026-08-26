import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import type { EntitlementValue, PlanStatus } from '@commerce-platform/database';

import type { PlanDomainEvent } from './events';
import { assertFeatureEntitlement, assertLimitEntitlement } from './registry';

export class Plan {
  private readonly entitlements = new Map<string, EntitlementValue>();
  private readonly events: PlanDomainEvent[] = [];
  private constructor(
    readonly id: string,
    private _code: string,
    private _name: string,
    private _status: PlanStatus,
    private _expectedVersion: number,
    private _version: number,
    private isNew: boolean,
    private readonly clock: () => Date,
    values: ReadonlyArray<{ code: string; value: EntitlementValue }>,
  ) {
    values.forEach(({ code, value }) => this.entitlements.set(code, value));
  }

  static create(
    input: { id: string; code: string; name: string },
    options: PlanOptions = {},
  ): Plan {
    const plan = new Plan(
      input.id,
      nonEmpty(input.code, 'code'),
      nonEmpty(input.name, 'name'),
      'DRAFT',
      0,
      1,
      true,
      options.clock ?? (() => new Date()),
      [],
    );
    plan.events.push({
      type: 'PlanCreated',
      occurredAt: plan.clock(),
      planId: plan.id,
      code: plan._code,
    });
    return plan;
  }
  static reconstitute(
    state: {
      id: string;
      code: string;
      name: string;
      status: PlanStatus;
      version: number;
      entitlements: ReadonlyArray<{ code: string; value: EntitlementValue }>;
    },
    options: PlanOptions = {},
  ): Plan {
    return new Plan(
      state.id,
      state.code,
      state.name,
      state.status,
      state.version,
      state.version,
      false,
      options.clock ?? (() => new Date()),
      state.entitlements,
    );
  }
  get code() {
    return this._code;
  }
  get name() {
    return this._name;
  }
  get status() {
    return this._status;
  }
  get version() {
    return this._version;
  }
  get expectedVersion() {
    return this._expectedVersion;
  }
  listEntitlements() {
    return [...this.entitlements].map(([code, value]) => ({ code, value }));
  }
  update(input: { code?: string; name?: string }): void {
    const code = input.code === undefined ? this._code : nonEmpty(input.code, 'code');
    const name = input.name === undefined ? this._name : nonEmpty(input.name, 'name');
    if (code === this._code && name === this._name)
      throw PlatformError.of(ERROR_CODES.OPERATION_NOT_ALLOWED, 'Plan is unchanged.');
    this._code = code;
    this._name = name;
    this.bump();
    this.events.push({ type: 'PlanUpdated', occurredAt: this.clock(), planId: this.id });
  }
  activate(): void {
    this.transition('ACTIVE', 'PlanActivated');
  }
  deactivate(): void {
    this.transition('INACTIVE');
  }
  setEntitlement(code: string, value: EntitlementValue): void {
    assertFeatureEntitlement(code, value);
    this.setValue(code, value);
  }
  setLimit(code: string, value: number): void {
    assertLimitEntitlement(code, value);
    this.setValue(code, value);
  }
  get hasPendingChanges() {
    return this.isNew || this._version !== this._expectedVersion;
  }
  collectChanges() {
    return {
      isNew: this.isNew,
      planId: this.id,
      code: this._code,
      name: this._name,
      status: this._status,
      expectedVersion: this._expectedVersion,
      nextVersion: this._version,
      entitlements: this.listEntitlements(),
    };
  }
  pullDomainEvents() {
    return this.events.splice(0);
  }
  markPersisted() {
    this._expectedVersion = this._version;
    this.isNew = false;
  }
  private transition(status: Extract<PlanStatus, 'ACTIVE' | 'INACTIVE'>, type?: 'PlanActivated') {
    if (this._status === status)
      throw PlatformError.of(ERROR_CODES.OPERATION_NOT_ALLOWED, `Plan is already ${status}.`);
    this._status = status;
    this.bump();
    if (type) this.events.push({ type, occurredAt: this.clock(), planId: this.id });
  }
  private setValue(code: string, value: EntitlementValue) {
    nonEmpty(code, 'code');
    this.entitlements.set(code, value);
    this.bump();
    this.events.push({
      type: 'PlanEntitlementChanged',
      occurredAt: this.clock(),
      planId: this.id,
      code,
      value,
    });
  }
  private bump() {
    this._version += 1;
  }
}
export interface PlanOptions {
  clock?: () => Date;
}
function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw PlatformError.validationFailed(`${field} must be a non-empty string.`, {
      details: { field },
    });
  return value;
}
