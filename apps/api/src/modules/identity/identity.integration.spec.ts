import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { PERMISSION_CATALOG, newId } from '@commerce-platform/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '@commerce-platform/testing';

import { AuthorizationService } from './application/authorization.service';
import { IdentityContractProvider } from './application/identity-contracts.provider';
import { IdentityProvisioningService } from './application/identity-provisioning.service';
import { IdentityService } from './application/identity.service';
import { OrganizationContractProvider } from '../organization/application/organization-contracts.provider';
import { OrganizationRepository } from '../organization/infrastructure/organization.repository';
import { OrganizationService } from '../organization/application/organization.service';
import { RoleRepository } from './infrastructure/role.repository';
import { UserRepository } from './infrastructure/user.repository';
import { AuthorizationQueryRepository } from './infrastructure/authorization.query-repository';

/**
 * Integration coverage for the Identity & Access context against REAL
 * PostgreSQL (docs/architecture/91-testing-architecture.md): migrations +
 * idempotent permission-catalog seed, global UNIQUE(email), composite tenant
 * FKs rejecting cross-tenant injections (Layer 3 of docs/architecture/
 * 71-multi-tenant-isolation.md), effective-permission composition across
 * branches, transactional outbox exactly-once semantics and root-version CAS.
 */
describe('Identity context persistence', () => {
  let testdb: TestDatabase;
  let organizations: OrganizationService;
  let orgContracts: OrganizationContractProvider;
  let identity: IdentityService;
  let authorization: AuthorizationService;
  let userRepository: UserRepository;
  let roleRepository: RoleRepository;
  let rawIdentity: IdentityService;
  let provisioning: IdentityProvisioningService;
  let actorA = '';

  /** Org A fixture shared by several tests (one branch). */
  const fixture = {
    organizationA: '',
    branchA1: '',
    branchA2: '',
    organizationB: '',
    branchB1: '',
  };

  async function createOrgWithBranches(
    name: string,
    branchCodes: string[],
  ): Promise<{ organizationId: string; branchIds: string[] }> {
    const created = await organizations.createOrganization({ name });
    const organizationId = created.organization.id;
    const branchIds: string[] = [];
    for (const code of branchCodes) {
      const branchId = newId();
      await organizations.createBranch({ organizationId, branchId, code, name: `${name} ${code}` });
      branchIds.push(branchId);
    }
    return { organizationId, branchIds };
  }

  beforeAll(async () => {
    testdb = await createTestDatabase();
    organizations = new OrganizationService(testdb.db, new OrganizationRepository());
    orgContracts = new OrganizationContractProvider(testdb.db);
    userRepository = new UserRepository();
    roleRepository = new RoleRepository();
    identity = new IdentityService(testdb.db, userRepository, roleRepository, orgContracts);
    provisioning = new IdentityProvisioningService(testdb.db, userRepository, roleRepository);
    authorization = new AuthorizationService(
      testdb.db,
      new AuthorizationQueryRepository(),
      orgContracts,
    );

    // Shared fixtures -------------------------------------------------------
    const orgA = await createOrgWithBranches('Identity Org A', ['BR-A1', 'BR-A2']);
    fixture.organizationA = orgA.organizationId;
    [fixture.branchA1, fixture.branchA2] = orgA.branchIds;

    const orgB = await createOrgWithBranches('Identity Org B', ['BR-B1']);
    fixture.organizationB = orgB.organizationId;
    fixture.branchB1 = orgB.branchIds[0]!;

    // Establish organization authorities through the dedicated provisioning boundary.
    const owners = new Map<string, string>();
    for (const organizationId of [fixture.organizationA, fixture.organizationB]) {
      const owner = await provisioning.provisionInitialOwner({
        organizationId,
        email: `owner-${organizationId}@test.io`,
        name: 'Bootstrap Owner',
        correlationId: newId(),
        causationId: newId(),
      });
      owners.set(organizationId, owner.user.id);
      if (organizationId === fixture.organizationA) actorA = owner.user.id;
    }
    rawIdentity = identity;
    identity = new Proxy(rawIdentity, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') return value;
        return (command: Record<string, unknown>, ...rest: unknown[]) => {
          if (command && typeof command === 'object' && 'organizationId' in command) {
            return value.call(
              target,
              {
                ...command,
                actorId: command.actorId ?? owners.get(String(command.organizationId)),
                correlationId: command.correlationId ?? newId(),
                causationId: command.causationId ?? newId(),
              },
              ...rest,
            );
          }
          return value.call(target, command, ...rest);
        };
      },
    }) as IdentityService;
  });

  afterAll(async () => {
    if (testdb) await testdb.teardown();
  });

  describe('migrations', () => {
    it('given a fresh database when migrations run then all identity tables exist', async () => {
      const { rows } = await testdb.client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'identity' ORDER BY table_name`,
      );

      expect(rows.map((row) => row.table_name)).toEqual([
        'branch_access',
        'initial_owner_assignments',
        'permissions',
        'role_permissions',
        'roles',
        'user_branch_roles',
        'user_organization_roles',
        'users',
      ]);
    });
  });

  describe('global permission catalog', () => {
    it('given the migration seed when read back then every catalog row matches the shipped PERMISSION_CATALOG', async () => {
      const { rows } = await testdb.client.query<{ code: string; description: string }>(
        'SELECT code, description FROM identity.permissions ORDER BY code',
      );

      expect(rows).toEqual([...PERMISSION_CATALOG].sort((a, b) => a.code.localeCompare(b.code)));
    });

    it('given the seed statement executed twice when compared then idempotent ON CONFLICT DO NOTHING keeps a single row set', async () => {
      // Re-deliver the catalog with DIFFERENT surrogate ids: only codes are
      // identity, conflicts must be skipped silently.
      const values = PERMISSION_CATALOG.map(
        (entry) => `('${newId()}', '${entry.code}', '${entry.description}')`,
      ).join(', ');
      await testdb.client.query(
        `INSERT INTO identity.permissions (id, code, description)
         VALUES ${values} ON CONFLICT ("code") DO NOTHING`,
      );
      await testdb.client.query(
        `INSERT INTO identity.permissions (id, code, description)
         VALUES ${values} ON CONFLICT ("code") DO NOTHING`,
      );

      const { rowCount } = await testdb.client.query('SELECT 1 FROM identity.permissions');
      expect(rowCount).toBe(PERMISSION_CATALOG.length);
    });
  });

  describe('UNIQUE(email) — global login handle', () => {
    it('given two users created with case-different emails through the service then normalization makes the second fail VALIDATION_FAILED', async () => {
      await identity.createUser({
        organizationId: fixture.organizationA,
        email: 'Unique.Case@Test.io',
        name: 'Case One',
      });

      let error: unknown;
      try {
        await identity.createUser({
          organizationId: fixture.organizationB, // even across tenants: login is GLOBAL
          email: 'unique.case@test.io',
          name: 'Case Two',
        });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      const platformError = error as { code: string; details?: Record<string, unknown> };
      expect(platformError.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(platformError.details).toMatchObject({ field: 'email' });
    });

    it('given a writer bypassing the application when inserting an exact duplicate email then the DB enforces users_email_unique with 23505', async () => {
      let dbError: { code?: string; constraint?: string } | null = null;
      try {
        await testdb.client.query(
          `INSERT INTO identity.users (id, organization_id, email, name)
           VALUES ($1, $2, $3, $4)`,
          [newId(), fixture.organizationA, 'raw-writer@test.io', 'Raw One'],
        );
        await testdb.client.query(
          `INSERT INTO identity.users (id, organization_id, email, name)
           VALUES ($1, $2, $3, $4)`,
          [newId(), fixture.organizationB, 'raw-writer@test.io', 'Raw Two'],
        );
      } catch (caught) {
        dbError = caught as { code?: string; constraint?: string };
      }

      expect(dbError).not.toBeNull();
      expect(dbError?.code).toBe('23505'); // unique_violation
      expect(dbError?.constraint).toBe('users_email_unique');
    });

    it('given a raw writer using a case variant when inserting then the lower(email) unique index rejects it', async () => {
      await testdb.client.query(
        `INSERT INTO identity.users (id, organization_id, email, name)
         VALUES ($1, $2, $3, $4)`,
        [newId(), fixture.organizationA, 'Raw.Case@Test.io', 'Raw Case One'],
      );

      let dbError: { code?: string; constraint?: string } | null = null;
      try {
        await testdb.client.query(
          `INSERT INTO identity.users (id, organization_id, email, name)
           VALUES ($1, $2, $3, $4)`,
          [newId(), fixture.organizationB, 'raw.case@test.io', 'Raw Case Two'],
        );
      } catch (caught) {
        dbError = caught as { code?: string; constraint?: string };
      }

      expect(dbError).not.toBeNull();
      expect(dbError?.code).toBe('23505');
      expect(dbError?.constraint).toBe('users_email_lower_unique');
    });
  });

  describe('composite tenant FKs (Layer 3 backstop)', () => {
    it('given a membership row pointing at another organization branch when inserted directly then the composite FK rejects it with 23503', async () => {
      const userOfB = await identity.createUser({
        organizationId: fixture.organizationB,
        email: 'cross-tenant-b@test.io',
        name: 'Tenant B User',
      });
      const roleOfB = await identity.createRole({
        organizationId: fixture.organizationB,
        code: 'EVIL',
        name: 'Evil Role',
      });

      let dbError: { code?: string; constraint?: string } | null = null;
      try {
        await testdb.client.query(
          `INSERT INTO identity.user_branch_roles (user_id, branch_id, role_id, organization_id)
           VALUES ($1, $2, $3, $4)`,
          [
            userOfB.user.id,
            fixture.branchA1, // branch owned by Org A...
            roleOfB.role.id,
            fixture.organizationB, // ...but claimed by Org B
          ],
        );
      } catch (caught) {
        dbError = caught as { code?: string; constraint?: string };
      }

      expect(dbError).not.toBeNull();
      expect(dbError?.code).toBe('23503'); // foreign_key_violation
      expect(dbError?.constraint).toBe('user_branch_roles_branch_tenant_fk');
    });

    it('given a membership row referencing another organization ROLE when inserted directly then the role tenant FK rejects it with 23503', async () => {
      const userOfB = await identity.createUser({
        organizationId: fixture.organizationB,
        email: 'role-fk-b@test.io',
        name: 'Tenant B User',
      });
      const roleOfA = await identity.createRole({
        organizationId: fixture.organizationA,
        code: 'OWN-A',
        name: 'Own Role A',
      });

      let dbError: { code?: string; constraint?: string } | null = null;
      try {
        // User and branch belong to Org B, but the role belongs to Org A.
        await testdb.client.query(
          `INSERT INTO identity.user_branch_roles (user_id, branch_id, role_id, organization_id)
           VALUES ($1, $2, $3, $4)`,
          [userOfB.user.id, fixture.branchB1, roleOfA.role.id, fixture.organizationB],
        );
      } catch (caught) {
        dbError = caught as { code?: string; constraint?: string };
      }

      expect(dbError).not.toBeNull();
      expect(dbError?.code).toBe('23503');
      expect(dbError?.constraint).toBe('user_branch_roles_role_tenant_fk');
    });

    it('given a branch_access row pointing at another organization branch when inserted directly then the access tenant FK rejects it with 23503', async () => {
      const userOfB = await identity.createUser({
        organizationId: fixture.organizationB,
        email: 'access-fk-b@test.io',
        name: 'Access B User',
      });

      let dbError: { code?: string; constraint?: string } | null = null;
      try {
        await testdb.client.query(
          `INSERT INTO identity.branch_access (user_id, branch_id, organization_id)
           VALUES ($1, $2, $3)`,
          [userOfB.user.id, fixture.branchA2, fixture.organizationB],
        );
      } catch (caught) {
        dbError = caught as { code?: string; constraint?: string };
      }

      expect(dbError).not.toBeNull();
      expect(dbError?.code).toBe('23503');
      expect(dbError?.constraint).toBe('branch_access_branch_tenant_fk');
    });

    it('given organization-role grants with foreign users or roles when inserted directly then composite tenant FKs reject both injections', async () => {
      const userB = await identity.createUser({
        organizationId: fixture.organizationB,
        email: 'org-grant-user-b@test.io',
        name: 'Org Grant B',
      });
      const roleA = await identity.createRole({
        organizationId: fixture.organizationA,
        code: 'ORG-GRANT-A',
        name: 'Org Grant A',
      });
      const first = await testdb.client
        .query(
          `INSERT INTO identity.user_organization_roles (user_id, role_id, organization_id) VALUES ($1, $2, $3)`,
          [userB.user.id, roleA.role.id, fixture.organizationB],
        )
        .catch((error: unknown) => error as { code?: string; constraint?: string });
      expect(first).toMatchObject({
        code: '23503',
        constraint: 'user_organization_roles_role_tenant_fk',
      });
      const roleB = await identity.createRole({
        organizationId: fixture.organizationB,
        code: 'ORG-GRANT-B',
        name: 'Org Grant B',
      });
      const userA = await identity.createUser({
        organizationId: fixture.organizationA,
        email: 'org-grant-user-a@test.io',
        name: 'Org Grant A',
      });
      const second = await testdb.client
        .query(
          `INSERT INTO identity.user_organization_roles (user_id, role_id, organization_id) VALUES ($1, $2, $3)`,
          [userA.user.id, roleB.role.id, fixture.organizationB],
        )
        .catch((error: unknown) => error as { code?: string; constraint?: string });
      expect(second).toMatchObject({
        code: '23503',
        constraint: 'user_organization_roles_user_tenant_fk',
      });
    });

    it('given initial-Owner claims with foreign users or roles when inserted directly then composite tenant FKs reject both injections', async () => {
      const userA = await identity.createUser({
        organizationId: fixture.organizationA,
        email: 'initial-owner-user-a@test.io',
        name: 'Initial Owner User A',
      });
      const roleA = await identity.createRole({
        organizationId: fixture.organizationA,
        code: 'INITIAL-OWNER-ROLE-A',
        name: 'Initial Owner Role A',
      });
      const orgC = await createOrgWithBranches('Initial Owner Raw FK', ['INITIAL-OWNER-FK']);
      const userCId = newId();
      const roleCId = newId();
      await testdb.client.query(
        'INSERT INTO identity.users (id, organization_id, email, name) VALUES ($1, $2, $3, $4)',
        [userCId, orgC.organizationId, 'initial-owner-raw-c@test.io', 'Initial Owner Raw C'],
      );
      await testdb.client.query(
        `INSERT INTO identity.roles (id, organization_id, code, name, is_system)
         VALUES ($1, $2, $3, $4, false)`,
        [roleCId, orgC.organizationId, 'INITIAL-OWNER-ROLE-C', 'Initial Owner Role C'],
      );

      const foreignRole = await testdb.client
        .query(
          `INSERT INTO identity.initial_owner_assignments (organization_id, user_id, role_id)
           VALUES ($1, $2, $3)`,
          [orgC.organizationId, userCId, roleA.role.id],
        )
        .catch((error: unknown) => error as { code?: string; constraint?: string });
      expect(foreignRole).toMatchObject({
        code: '23503',
        constraint: 'initial_owner_assignments_role_tenant_fk',
      });

      const foreignUser = await testdb.client
        .query(
          `INSERT INTO identity.initial_owner_assignments (organization_id, user_id, role_id)
           VALUES ($1, $2, $3)`,
          [orgC.organizationId, userA.user.id, roleCId],
        )
        .catch((error: unknown) => error as { code?: string; constraint?: string });
      expect(foreignUser).toMatchObject({
        code: '23503',
        constraint: 'initial_owner_assignments_user_tenant_fk',
      });
    });

    it('given correctly bound rows when inserted through the aggregates then the same composite FKs accept them silently', async () => {
      const user = await identity.createUser({
        organizationId: fixture.organizationA,
        email: 'happy-path@test.io',
        name: 'Happy Path',
      });
      const role = await identity.createRole({
        organizationId: fixture.organizationA,
        code: 'HAPPY',
        name: 'Happy Role',
      });

      const result = await identity.assignRole({
        organizationId: fixture.organizationA,
        userId: user.user.id,
        roleId: role.role.id,
        branchId: fixture.branchA1,
      });
      expect(result.eventsPersisted).toBe(2);

      const { rowCount } = await testdb.client.query(
        'SELECT 1 FROM identity.user_branch_roles WHERE user_id = $1 AND organization_id = $2',
        [user.user.id, fixture.organizationA],
      );
      expect(rowCount).toBe(1);
    });
  });

  describe('command validation via contracts', () => {
    it('given a branch of ANOTHER organization when assigning a role then RESOURCE_NOT_FOUND (cross-tenant = missing)', async () => {
      const user = await identity.createUser({
        organizationId: fixture.organizationA,
        email: 'validate-branch@test.io',
        name: 'Validator',
      });
      const role = await identity.createRole({
        organizationId: fixture.organizationA,
        code: 'VAL',
        name: 'Validator Role',
      });

      await expect(
        identity.assignRole({
          organizationId: fixture.organizationA,
          userId: user.user.id,
          roleId: role.role.id,
          branchId: fixture.branchB1, // belongs to Org B
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.RESOURCE_NOT_FOUND });
    });

    it('given a role of ANOTHER organization when assigning then RESOURCE_NOT_FOUND (role must belong to same org)', async () => {
      const userOfB = await identity.createUser({
        organizationId: fixture.organizationB,
        email: 'validate-role@test.io',
        name: 'Role Validator B',
      });
      const roleOfA = await identity.createRole({
        organizationId: fixture.organizationA,
        code: 'VAL-A',
        name: 'Validator Role A',
      });

      await expect(
        identity.assignRole({
          organizationId: fixture.organizationB,
          userId: userOfB.user.id,
          roleId: roleOfA.role.id,
          branchId: fixture.branchB1,
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.RESOURCE_NOT_FOUND });
    });
  });

  describe('organization-scoped role grants', () => {
    it('given an active non-self role-grant manager when granting Owner to another user then it succeeds, while self-grant is denied', async () => {
      const manager = await identity.createUser({
        organizationId: fixture.organizationA,
        email: 'owner-grant-manager@test.io',
        name: 'Owner Grant Manager',
      });
      const recipient = await identity.createUser({
        organizationId: fixture.organizationA,
        email: 'owner-grant-recipient@test.io',
        name: 'Owner Grant Recipient',
      });
      const grantManagerRole = await identity.createRole({
        organizationId: fixture.organizationA,
        code: 'ROLE_GRANT_MANAGER',
        name: 'Role Grant Manager',
      });
      await identity.setRolePermissions({
        organizationId: fixture.organizationA,
        roleId: grantManagerRole.role.id,
        permissionCodes: ['role-grants.manage'],
      });
      await identity.assignOrganizationRole({
        organizationId: fixture.organizationA,
        userId: manager.user.id,
        roleId: grantManagerRole.role.id,
      });
      const { rows } = await testdb.client.query<{ id: string }>(
        `SELECT id FROM identity.roles
         WHERE organization_id = $1 AND code = 'OWNER'`,
        [fixture.organizationA],
      );
      const ownerRoleId = rows[0]!.id;

      await expect(
        rawIdentity.assignOrganizationRole({
          organizationId: fixture.organizationA,
          userId: recipient.user.id,
          roleId: ownerRoleId,
          actorId: manager.user.id,
          correlationId: newId(),
          causationId: newId(),
        }),
      ).resolves.toBeUndefined();
      await expect(
        rawIdentity.assignOrganizationRole({
          organizationId: fixture.organizationA,
          userId: manager.user.id,
          roleId: ownerRoleId,
          actorId: manager.user.id,
          correlationId: newId(),
          causationId: newId(),
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.PERMISSION_DENIED });
    });
  });

  describe('effective permissions & authorization flow', () => {
    let salesUserId: string;
    let viewOnlyUserId: string;
    const SALES_ROLE_A1 = 'sales-at-a1';

    beforeAll(async () => {
      const salesUser = await identity.createUser({
        organizationId: fixture.organizationA,
        email: 'sales-clerk@test.io',
        name: 'Sales Clerk',
      });
      salesUserId = salesUser.user.id;

      const salesRole = await identity.createRole({
        organizationId: fixture.organizationA,
        code: SALES_ROLE_A1,
        name: 'Branch Sales',
      });
      await identity.setRolePermissions({
        organizationId: fixture.organizationA,
        roleId: salesRole.role.id,
        permissionCodes: ['sales.create', 'refund.create'],
      });
      await identity.assignRole({
        organizationId: fixture.organizationA,
        userId: salesUserId,
        roleId: salesRole.role.id,
        branchId: fixture.branchA1,
      });

      const cashierRole = await identity.createRole({
        organizationId: fixture.organizationA,
        code: 'CASHIER-A2',
        name: 'Back Office',
      });
      await identity.setRolePermissions({
        organizationId: fixture.organizationA,
        roleId: cashierRole.role.id,
        permissionCodes: ['inventory.view'],
      });
      await identity.assignRole({
        organizationId: fixture.organizationA,
        userId: salesUserId,
        roleId: cashierRole.role.id,
        branchId: fixture.branchA2,
      });

      // View-only staff: explicit access WITHOUT any role.
      const viewer = await identity.createUser({
        organizationId: fixture.organizationA,
        email: 'view-only@test.io',
        name: 'View Only',
      });
      viewOnlyUserId = viewer.user.id;
      await identity.grantBranchAccess({
        organizationId: fixture.organizationA,
        userId: viewOnlyUserId,
        branchId: fixture.branchA1,
      });
    });

    it('given roles at two branches when reading effective permissions per branch then each scope sees ONLY its own grants', async () => {
      await expect(
        authorization.getEffectivePermissions(salesUserId, fixture.organizationA, fixture.branchA1),
      ).resolves.toEqual(['refund.create', 'sales.create']);

      await expect(
        authorization.getEffectivePermissions(salesUserId, fixture.organizationA, fixture.branchA2),
      ).resolves.toEqual(['inventory.view']);
    });

    it('given no branch filter when reading effective permissions then the union across branches is returned sorted', async () => {
      await expect(
        authorization.getEffectivePermissions(salesUserId, fixture.organizationA),
      ).resolves.toEqual(['inventory.view', 'refund.create', 'sales.create']);
    });

    it('given a view-only grant without any role when queried then effective permissions are EMPTY although branch scope exists', async () => {
      await expect(
        authorization.getEffectivePermissions(viewOnlyUserId, fixture.organizationA),
      ).resolves.toEqual([]);

      const decision = await authorization.authorize({
        userId: viewOnlyUserId,
        organizationId: fixture.organizationA,
        permissionCode: 'sales.create',
        branchId: fixture.branchA1,
      });
      expect(decision).toEqual({ allowed: false, reason: 'PERMISSION_NOT_HELD' });
    });

    it('given the holder at their branch when authorizing then ALLOWED; at the other branch then PERMISSION_NOT_HELD', async () => {
      const atA1 = await authorization.authorize({
        userId: salesUserId,
        organizationId: fixture.organizationA,
        permissionCode: 'sales.create',
        branchId: fixture.branchA1,
      });
      expect(atA1).toEqual({ allowed: true, reason: null });

      const decisionAtA2 = await authorization.authorize({
        userId: salesUserId,
        organizationId: fixture.organizationA,
        permissionCode: 'sales.create',
        branchId: fixture.branchA2,
      });
      expect(decisionAtA2).toEqual({ allowed: false, reason: 'PERMISSION_NOT_HELD' });

      await expect(
        authorization.assertAuthorize({
          userId: salesUserId,
          organizationId: fixture.organizationA,
          permissionCode: 'sales.create',
          branchId: fixture.branchA2,
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.PERMISSION_DENIED });
    });

    it('given a suspended user with intact memberships when authorizing then USER_SUSPENDED denies while data stays', async () => {
      await identity.suspendUser({
        organizationId: fixture.organizationA,
        userId: salesUserId,
        actorId: actorA,
      });

      const decision = await authorization.authorize({
        userId: salesUserId,
        organizationId: fixture.organizationA,
        permissionCode: 'sales.create',
        branchId: fixture.branchA1,
      });
      expect(decision).toEqual({ allowed: false, reason: 'USER_SUSPENDED' });

      // Data retained; reactivate restores authorization.
      await identity.reactivateUser({
        organizationId: fixture.organizationA,
        userId: salesUserId,
        actorId: actorA,
      });
      const restored = await authorization.authorize({
        userId: salesUserId,
        organizationId: fixture.organizationA,
        permissionCode: 'sales.create',
        branchId: fixture.branchA1,
      });
      expect(restored).toEqual({ allowed: true, reason: null });
    });

    it('given a user of ANOTHER organization when authorizing or listing permissions then RESOURCE_NOT_FOUND', async () => {
      const userOfB = await identity.createUser({
        organizationId: fixture.organizationB,
        email: 'isolation-probe@test.io',
        name: 'Probe B',
      });

      await expect(
        authorization.authorize({
          userId: userOfB.user.id,
          organizationId: fixture.organizationA, // wrong tenant on purpose
          permissionCode: 'users.manage',
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.RESOURCE_NOT_FOUND });

      await expect(
        authorization.getEffectivePermissions(userOfB.user.id, fixture.organizationA),
      ).rejects.toMatchObject({ code: ERROR_CODES.RESOURCE_NOT_FOUND });
    });
  });

  describe('identity administration actor provenance', () => {
    it('given a suspended actor when administering identity then assertAdmin denies ACCOUNT_SUSPENDED', async () => {
      const suspendedActor = await identity.createUser({
        organizationId: fixture.organizationA,
        email: 'suspended-admin@test.io',
        name: 'Suspended Admin',
      });
      await identity.suspendUser({
        organizationId: fixture.organizationA,
        userId: suspendedActor.user.id,
        actorId: actorA,
      });

      await expect(
        rawIdentity.createUser({
          organizationId: fixture.organizationA,
          email: 'blocked-by-suspension@test.io',
          name: 'Blocked',
          actorId: suspendedActor.user.id,
          correlationId: newId(),
          causationId: newId(),
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.ACCOUNT_SUSPENDED });
    });

    it('given normal mutations when persisted then human actor and trace ids are preserved and SYSTEM is rejected', async () => {
      const correlationId = newId();
      const causationId = newId();
      const result = await rawIdentity.createUser({
        organizationId: fixture.organizationA,
        email: 'provenance@test.io',
        name: 'Provenance',
        actorId: actorA,
        correlationId,
        causationId,
      });
      const { rows } = await testdb.client.query<{ payload: Record<string, unknown> }>(
        'SELECT payload FROM integration.outbox WHERE aggregate_id = $1',
        [result.user.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.payload).toMatchObject({
        actor: { id: actorA },
        correlationId,
        causationId,
        payload: { organizationId: fixture.organizationA, userId: result.user.id },
      });
      expect(JSON.stringify(rows[0]!.payload)).not.toContain('SYSTEM');

      await expect(
        rawIdentity.createUser({
          organizationId: fixture.organizationA,
          email: 'system-is-not-human@test.io',
          name: 'System Is Not Human',
          actorId: 'SYSTEM',
          correlationId: newId(),
          causationId: newId(),
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.PERMISSION_DENIED });

      await expect(
        rawIdentity.createUser({
          organizationId: fixture.organizationA,
          email: 'missing-actor@test.io',
          name: 'Missing Actor',
          correlationId: newId(),
          causationId: newId(),
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.PERMISSION_DENIED });
    });

    it('given provisionInitialOwner when invoked then all SYSTEM effects are traceable and same-identity retries are idempotent', async () => {
      const org = await createOrgWithBranches('Provisioning Workflow', ['PROVISION']);
      const correlationId = newId();
      const causationId = newId();
      const command = {
        organizationId: org.organizationId,
        email: 'provisioned-owner@test.io',
        name: 'Provisioned Owner',
        correlationId,
        causationId,
      };
      const owner = await provisioning.provisionInitialOwner(command);
      const retry = await provisioning.provisionInitialOwner({
        ...command,
        correlationId: newId(),
        causationId: newId(),
      });
      expect(retry.user.id).toBe(owner.user.id);
      expect(retry.eventsPersisted).toBe(0);

      const [{ owner_role_id: ownerRoleId }] = (
        await testdb.client.query<{ owner_role_id: string }>(
          `SELECT id AS owner_role_id FROM identity.roles
           WHERE organization_id = $1 AND code = 'OWNER'`,
          [org.organizationId],
        )
      ).rows;
      const laterOwner = await rawIdentity.createUser({
        organizationId: org.organizationId,
        email: 'later-owner@test.io',
        name: 'Later Owner',
        actorId: owner.user.id,
        correlationId: newId(),
        causationId: newId(),
      });
      await rawIdentity.assignOrganizationRole({
        organizationId: org.organizationId,
        userId: laterOwner.user.id,
        roleId: ownerRoleId!,
        actorId: owner.user.id,
        correlationId: newId(),
        causationId: newId(),
      });
      await rawIdentity.revokeOrganizationRole({
        organizationId: org.organizationId,
        userId: laterOwner.user.id,
        roleId: ownerRoleId!,
        actorId: owner.user.id,
        correlationId: newId(),
        causationId: newId(),
      });
      const retryAfterLaterOwnerChange = await provisioning.provisionInitialOwner({
        ...command,
        correlationId: newId(),
        causationId: newId(),
      });
      expect(retryAfterLaterOwnerChange).toMatchObject({
        user: { id: owner.user.id },
        eventsPersisted: 0,
      });
      const bootstrapState = await testdb.client.query<{ claims: string; owner_grants: string }>(
        `SELECT
           (SELECT count(*) FROM identity.initial_owner_assignments WHERE organization_id = $1) AS claims,
           (SELECT count(*) FROM identity.user_organization_roles
            WHERE organization_id = $1 AND role_id = $2) AS owner_grants`,
        [org.organizationId, ownerRoleId],
      );
      expect(bootstrapState.rows[0]).toEqual({ claims: '1', owner_grants: '1' });

      const { rows } = await testdb.client.query<{
        event_type: string;
        payload: Record<string, unknown>;
      }>('SELECT event_type, payload FROM integration.outbox WHERE correlation_id = $1', [
        correlationId,
      ]);
      expect(
        rows.some((row) => row.event_type === 'identity.user-organization-role-assigned'),
      ).toBe(true);
      for (const row of rows) {
        expect(row.payload).toMatchObject({ eventVersion: 1, actor: { id: 'SYSTEM' } });
      }
      const grant = rows.find(
        (row) => row.event_type === 'identity.user-organization-role-assigned',
      )!;
      expect(grant.payload).toMatchObject({ correlationId, causationId });
      expect(JSON.stringify(rows)).not.toContain('provisioned-owner@test.io');
      expect(JSON.stringify(rows)).not.toContain('Provisioned Owner');

      const otherUser = await rawIdentity.createUser({
        organizationId: org.organizationId,
        email: 'other-existing-user@test.io',
        name: 'Other Existing User',
        actorId: owner.user.id,
        correlationId: newId(),
        causationId: newId(),
      });
      await expect(
        provisioning.provisionInitialOwner({
          organizationId: org.organizationId,
          email: 'other-existing-user@test.io',
          name: 'Other Existing User',
          userId: otherUser.user.id,
          correlationId: newId(),
          causationId: newId(),
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });

      await expect(
        provisioning.provisionInitialOwner({
          organizationId: org.organizationId,
          email: 'missing-provisioning-trace@test.io',
          name: 'Missing Trace',
          causationId: newId(),
        } as unknown as Parameters<typeof provisioning.provisionInitialOwner>[0]),
      ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
      await expect(
        provisioning.provisionInitialOwner({
          organizationId: org.organizationId,
          email: 'missing-provisioning-causation@test.io',
          name: 'Missing Causation',
          correlationId: newId(),
        } as unknown as Parameters<typeof provisioning.provisionInitialOwner>[0]),
      ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });

      const contracts = new IdentityContractProvider(authorization);
      expect(contracts).not.toHaveProperty('provisionInitialOwner');
      expect(provisioning).not.toHaveProperty('createInitialUser');
      expect(provisioning).not.toHaveProperty('createDefaultRoleTemplates');
      expect(provisioning).not.toHaveProperty('establishInitialOwnerRole');
    });

    it('serializes a privileged grant ahead of a subsequently requested admin-capability revocation', async () => {
      const org = await createOrgWithBranches('Identity Admin Lock', ['LOCK']);
      const ownerA = await provisioning.provisionInitialOwner({
        organizationId: org.organizationId,
        email: 'lock-owner-a@test.io',
        name: 'Lock Owner A',
        correlationId: newId(),
        causationId: newId(),
      });
      const [{ id: ownerRoleId }] = (
        await testdb.client.query<{ id: string }>(
          "SELECT id FROM identity.roles WHERE organization_id = $1 AND code = 'OWNER'",
          [org.organizationId],
        )
      ).rows;
      const ownerB = await rawIdentity.createUser({
        organizationId: org.organizationId,
        email: 'lock-owner-b@test.io',
        name: 'Lock Owner B',
        actorId: ownerA.user.id,
        correlationId: newId(),
        causationId: newId(),
      });
      await rawIdentity.assignOrganizationRole({
        organizationId: org.organizationId,
        userId: ownerB.user.id,
        roleId: ownerRoleId!,
        actorId: ownerA.user.id,
        correlationId: newId(),
        causationId: newId(),
      });
      const target = await rawIdentity.createUser({
        organizationId: org.organizationId,
        email: 'lock-target@test.io',
        name: 'Lock Target',
        actorId: ownerA.user.id,
        correlationId: newId(),
        causationId: newId(),
      });

      const lockConnection = await testdb.client.connect();
      await lockConnection.query('BEGIN');
      await lockConnection.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 1))', [
        org.organizationId,
      ]);
      try {
        const grant = rawIdentity.assignOrganizationRole({
          organizationId: org.organizationId,
          userId: target.user.id,
          roleId: ownerRoleId!,
          actorId: ownerA.user.id,
          correlationId: newId(),
          causationId: newId(),
        });
        await waitForWaitingAdvisoryLock(testdb);
        const revoke = rawIdentity.revokeOrganizationRole({
          organizationId: org.organizationId,
          userId: ownerA.user.id,
          roleId: ownerRoleId!,
          actorId: ownerB.user.id,
          correlationId: newId(),
          causationId: newId(),
        });
        await lockConnection.query('COMMIT');
        await expect(grant).resolves.toBeUndefined();
        await expect(revoke).resolves.toBeUndefined();
      } finally {
        await lockConnection.query('ROLLBACK').catch(() => undefined);
        lockConnection.release();
      }
      const result = await testdb.client.query<{ grants: string; owner_a_grants: string }>(
        `SELECT
           (SELECT count(*) FROM identity.user_organization_roles WHERE organization_id = $1 AND user_id = $2 AND role_id = $3) AS grants,
           (SELECT count(*) FROM identity.user_organization_roles WHERE organization_id = $1 AND user_id = $4 AND role_id = $3) AS owner_a_grants`,
        [org.organizationId, target.user.id, ownerRoleId, ownerA.user.id],
      );
      expect(result.rows[0]).toEqual({ grants: '1', owner_a_grants: '0' });
    });

    it('given concurrent initial-owner requests when claimed then exactly one durable Owner assignment wins', async () => {
      const org = await createOrgWithBranches('Concurrent Initial Owner', ['CONCURRENT']);
      const [first, second] = await Promise.allSettled([
        provisioning.provisionInitialOwner({
          organizationId: org.organizationId,
          email: 'concurrent-owner-a@test.io',
          name: 'Concurrent Owner A',
          correlationId: newId(),
          causationId: newId(),
        }),
        provisioning.provisionInitialOwner({
          organizationId: org.organizationId,
          email: 'concurrent-owner-b@test.io',
          name: 'Concurrent Owner B',
          correlationId: newId(),
          causationId: newId(),
        }),
      ]);
      let winnerUserId: string;
      let loserReason: unknown;
      if (first.status === 'fulfilled' && second.status === 'rejected') {
        winnerUserId = first.value.user.id;
        loserReason = second.reason;
      } else if (second.status === 'fulfilled' && first.status === 'rejected') {
        winnerUserId = second.value.user.id;
        loserReason = first.reason;
      } else {
        throw new Error('Exactly one concurrent initial-owner request must succeed.');
      }
      expect(loserReason).toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });

      const assignments = await testdb.client.query<{ user_id: string; role_id: string }>(
        'SELECT user_id, role_id FROM identity.initial_owner_assignments WHERE organization_id = $1',
        [org.organizationId],
      );
      expect(assignments.rowCount).toBe(1);
      expect(assignments.rows[0]!.user_id).toBe(winnerUserId);

      const ownerGrants = await testdb.client.query<{ user_id: string }>(
        `SELECT grants.user_id
         FROM identity.user_organization_roles AS grants
         JOIN identity.roles AS roles ON roles.id = grants.role_id
         WHERE grants.organization_id = $1 AND roles.code = 'OWNER'`,
        [org.organizationId],
      );
      expect(ownerGrants.rowCount).toBe(1);
      expect(ownerGrants.rows[0]!.user_id).toBe(winnerUserId);

      const duplicate = await testdb.client
        .query(
          `INSERT INTO identity.initial_owner_assignments (organization_id, user_id, role_id)
           VALUES ($1, $2, $3)`,
          [org.organizationId, assignments.rows[0]!.user_id, assignments.rows[0]!.role_id],
        )
        .catch((error: unknown) => error as { code?: string });
      expect(duplicate).toMatchObject({ code: '23505' });
    });
  });

  describe('transactional outbox', () => {
    it('given a command sequence when persisted then exactly one row per event lands with stable aggregate types and payloads', async () => {
      const user = await identity.createUser({
        organizationId: fixture.organizationA,
        email: 'outbox-user@test.io',
        name: 'Outbox User',
        supabaseUserId: 'supabase-outbox-1',
      });
      const role = await identity.createRole({
        organizationId: fixture.organizationA,
        code: 'OB-ROLE',
        name: 'Outbox Role',
        isSystem: true,
      });
      await identity.setRolePermissions({
        organizationId: fixture.organizationA,
        roleId: role.role.id,
        permissionCodes: ['delivery.manage'],
      });
      await identity.assignRole({
        organizationId: fixture.organizationA,
        userId: user.user.id,
        roleId: role.role.id,
        branchId: fixture.branchA1,
      });

      const { rows } = await testdb.client.query<{
        aggregate_type: string;
        aggregate_id: string;
        event_type: string;
        payload: Record<string, unknown>;
      }>(
        `SELECT aggregate_type, aggregate_id, event_type, payload
         FROM integration.outbox
         WHERE aggregate_id IN ($1, $2)
         ORDER BY occurred_at, created_at, id`,
        [user.user.id, role.role.id],
      );

      expect(rows.map((row) => [row.aggregate_type, row.event_type])).toEqual([
        ['IdentityUser', 'identity.user-created'],
        ['IdentityUser', 'identity.user-identity-linked'],
        ['IdentityRole', 'identity.role-created'],
        ['IdentityRole', 'identity.role-permissions-changed'],
        ['IdentityUser', 'identity.user-role-assigned'],
        ['IdentityUser', 'identity.branch-access-granted'], // first presence on the branch implies access
      ]);
      expect(JSON.parse(JSON.stringify(rows[0]!.payload))).toMatchObject({
        eventType: 'identity.user-created',
        organizationId: fixture.organizationA,
        aggregateType: 'IdentityUser',
      });
      const envelope = rows[0]!.payload;
      expect(envelope).toMatchObject({
        eventVersion: 1,
        organizationId: fixture.organizationA,
        aggregateId: user.user.id,
        actor: { id: expect.any(String) },
      });
      for (const key of [
        'eventId',
        'eventType',
        'occurredAt',
        'aggregateVersion',
        'correlationId',
        'causationId',
        'payload',
      ])
        expect(envelope).toHaveProperty(key);
      expect(JSON.stringify(envelope)).not.toContain('outbox-user@test.io');
      expect(JSON.stringify(envelope)).not.toContain('Outbox User');
      expect(JSON.parse(JSON.stringify(rows[3]!.payload))).toMatchObject({
        eventType: 'identity.role-permissions-changed',
      });
    });

    it('given a clean aggregate saved again when saved then zero events are appended (no CAS bump, no outbox noise)', async () => {
      const user = await identity.createUser({
        organizationId: fixture.organizationA,
        email: 'quiet-user@test.io',
        name: 'Quiet User',
      });

      const loaded = await userRepository.findUser(testdb.db, fixture.organizationA, user.user.id);
      const eventsPersisted = await userRepository.save(testdb.db, loaded!, {
        actorId: actorA,
        correlationId: newId(),
        causationId: newId(),
      });
      expect(eventsPersisted).toBe(0);

      const { rows } = await testdb.client.query<{ count: string }>(
        'SELECT count(*) AS count FROM integration.outbox WHERE aggregate_id = $1',
        [user.user.id],
      );
      expect(rows[0]!.count).toBe('1'); // only the original UserCreated
    });

    it('given a revoked role when persisted then UserRoleRevoked is the only new event and access survives', async () => {
      const user = await identity.createUser({
        organizationId: fixture.organizationA,
        email: 'revoke-flow@test.io',
        name: 'Revoke Flow',
      });
      const role = await identity.createRole({
        organizationId: fixture.organizationA,
        code: 'RV-ROLE',
        name: 'Revoke Role',
      });
      await identity.assignRole({
        organizationId: fixture.organizationA,
        userId: user.user.id,
        roleId: role.role.id,
        branchId: fixture.branchA2,
      });

      await identity.revokeRole({
        organizationId: fixture.organizationA,
        userId: user.user.id,
        roleId: role.role.id,
        branchId: fixture.branchA2,
      });

      const { rows } = await testdb.client.query<{ event_type: string }>(
        `SELECT event_type FROM integration.outbox WHERE aggregate_id = $1
         ORDER BY occurred_at, created_at, id`,
        [user.user.id],
      );
      expect(rows.map((row) => row.event_type)).toEqual([
        'identity.user-created',
        'identity.user-role-assigned',
        'identity.branch-access-granted',
        'identity.user-role-revoked',
      ]);

      const { rowCount: accessRows } = await testdb.client.query(
        'SELECT 1 FROM identity.branch_access WHERE user_id = $1 AND branch_id = $2',
        [user.user.id, fixture.branchA2],
      );
      expect(accessRows).toBe(1); // explicit access survives role revocation
    });
  });

  describe('optimistic concurrency', () => {
    it('given two aggregates loaded from the same version when both are saved sequentially then the second save raises RESOURCE_VERSION_CONFLICT', async () => {
      const user = await identity.createUser({
        organizationId: fixture.organizationA,
        email: 'cas-user@test.io',
        name: 'CAS User',
      });

      const first = await userRepository.findUser(testdb.db, fixture.organizationA, user.user.id);
      const second = await userRepository.findUser(testdb.db, fixture.organizationA, user.user.id);

      first!.grantBranchAccess(fixture.branchA1);
      await userRepository.save(testdb.db, first!, {
        actorId: actorA,
        correlationId: newId(),
        causationId: newId(),
      });

      second!.suspend();

      let error: unknown;
      try {
        await userRepository.save(testdb.db, second!, {
          actorId: actorA,
          correlationId: newId(),
          causationId: newId(),
        });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      const platformError = error as { code: string; details?: Record<string, unknown> };
      expect(platformError.code).toBe(ERROR_CODES.RESOURCE_VERSION_CONFLICT);
      expect(platformError.details).toMatchObject({ expectedVersion: 1 });

      // The loser rolled back completely: the suspension never landed.
      // (suspend() is state-only by design and emits no outbox event.)
      const { rows } = await testdb.client.query<{ status: string }>(
        'SELECT status FROM identity.users WHERE id = $1',
        [user.user.id],
      );
      expect(rows[0]!.status).toBe('ACTIVE');
    });
  });
});

/** Wait for the controlled transaction to demonstrate a real blocked lock. */
async function waitForWaitingAdvisoryLock(testdb: TestDatabase): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { rows } = await testdb.client.query<{ count: string }>(
      "SELECT count(*) AS count FROM pg_locks WHERE locktype = 'advisory' AND NOT granted",
    );
    if (rows[0]?.count !== '0') return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('The privileged mutation did not wait on the organization identity-admin lock.');
}
