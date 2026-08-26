import { describe, expect, it } from 'vitest';

import { evaluateAuthorization, type AuthorizationInput } from './authorize';

const USER_ID = '0198b000-0000-7000-8000-00000000u001';
const B1 = '0198b000-0000-7000-8000-0000000000b1';
const B2 = '0198b000-0000-7000-8000-0000000000b2';

/** A fully-privileged ACTIVE user baseline; individual cases override. */
function baseInput(overrides: Partial<AuthorizationInput> = {}): AuthorizationInput {
  return {
    permissionCode: 'sales.create',
    user: { id: USER_ID, status: 'ACTIVE' },
    memberships: [{ branchId: B1, permissionCodes: ['sales.create', 'refund.create'] }],
    branchScope: [B1],
    targetBranchId: B1,
    policyAllows: true,
    ...overrides,
  };
}

describe('evaluateAuthorization (docs/architecture/72 scope formula)', () => {
  it('given an active holder targeting a branch inside scope with default policy when evaluating then ALLOWED', () => {
    expect(evaluateAuthorization(baseInput())).toEqual({ allowed: true, reason: null });
  });

  it('given an organization-wide action with only a branch role when evaluating then branch permissions do not qualify', () => {
    const decision = evaluateAuthorization(
      baseInput({
        targetBranchId: undefined,
        branchScope: [], // no explicit access anywhere; membership alone counts
      }),
    );
    expect(decision).toEqual({ allowed: false, reason: 'PERMISSION_NOT_HELD' });
  });

  // ---------------------------------------------------------------------------
  // Truth table: every denial reason, one row per cause
  // ---------------------------------------------------------------------------

  it.each([
    [
      'suspended user (resource-state layer denies before anything else)',
      baseInput({ user: { id: USER_ID, status: 'SUSPENDED' } }),
      'USER_SUSPENDED',
    ],
    [
      'unknown permission code (not part of the catalog)',
      baseInput({ knownPermissionCodes: ['sales.create'], permissionCode: 'sales.somethingElse' }),
      'PERMISSION_UNKNOWN',
    ],
    ['missing membership entirely', baseInput({ memberships: [] }), 'PERMISSION_NOT_HELD'],
    [
      'membership exists at another branch but NOT at the target branch (role/permissions may differ per Branch)',
      baseInput({ targetBranchId: B2, branchScope: [B1, B2] }),
      'PERMISSION_NOT_HELD',
    ],
    [
      'view-only access: branch in scope but no role grants the capability there',
      baseInput({
        memberships: [],
        branchScope: [B1], // access WITHOUT roles
        targetBranchId: B1,
      }),
      'PERMISSION_NOT_HELD',
    ],
    [
      'organization policy denies the action',
      baseInput({ policyAllows: false }),
      'ORG_POLICY_DENIED',
    ],
    [
      'branch scope excludes the target branch (defense-in-depth conjunct)',
      baseInput({ targetBranchId: B1, branchScope: [] }),
      'BRANCH_SCOPE_EXCLUDED',
    ],
  ] as const)('given %s when evaluating then denied with %s', (_label, input, expectedReason) => {
    expect(evaluateAuthorization(input)).toEqual({ allowed: false, reason: expectedReason });
  });

  // ---------------------------------------------------------------------------
  // Evaluation order precedence (formula evaluated in documented order)
  // ---------------------------------------------------------------------------

  it('given a suspended user AND an unknown code when evaluating then USER_SUSPENDED wins (principal precondition first)', () => {
    const decision = evaluateAuthorization(
      baseInput({
        user: { id: USER_ID, status: 'SUSPENDED' },
        permissionCode: 'nope.nope',
        knownPermissionCodes: ['sales.create'],
      }),
    );
    expect(decision).toEqual({ allowed: false, reason: 'USER_SUSPENDED' });
  });

  it('given an unknown code AND denying policy when evaluating then PERMISSION_UNKNOWN wins ("Permission allowed" precedes policy)', () => {
    const decision = evaluateAuthorization(
      baseInput({
        permissionCode: 'nope.nope',
        knownPermissionCodes: ['sales.create'],
        policyAllows: false,
      }),
    );
    expect(decision).toEqual({ allowed: false, reason: 'PERMISSION_UNKNOWN' });
  });

  it('given denying policy AND out-of-scope branch when evaluating then ORG_POLICY_DENIED wins (policy precedes branch scope)', () => {
    const decision = evaluateAuthorization(
      baseInput({
        targetBranchId: B2,
        branchScope: [B2],
        memberships: [{ branchId: B2, permissionCodes: ['sales.create'] }],
        policyAllows: false,
      }),
    );
    expect(decision).toEqual({ allowed: false, reason: 'ORG_POLICY_DENIED' });
  });

  it('given no knownPermissionCodes universe supplied when evaluating then unknown codes fall back to PERMISSION_NOT_HELD', () => {
    const decision = evaluateAuthorization(baseInput({ permissionCode: 'nope.nope' }));
    expect(decision).toEqual({ allowed: false, reason: 'PERMISSION_NOT_HELD' });
  });
});
