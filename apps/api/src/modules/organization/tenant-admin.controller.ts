import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import {
  branchAccess,
  branches,
  warehouses,
  type DatabaseClient,
} from '@commerce-platform/database';
import { branchIdSchema, PlatformError } from '@commerce-platform/contracts';
import { TenantBearerGuard, type AuthenticatedRequest } from '../../common/auth/http-auth.guards';
import type { OrganizationUserPrincipal } from '../../common/auth/authenticated-principal';
import { correlationIdFor } from '../../common/http/correlation';
import { DATABASE } from '../database/database.tokens';
import { ENTITLEMENT_SERVICE, type EntitlementServiceContract } from '../entitlements/contracts';
import { IDENTITY_CONTRACTS, type IdentityContracts } from '../identity/contracts';
import { TenantOrganizationMutationAdapter } from './application/tenant-organization-mutation.adapter';

const text = z.string().trim().min(1).max(200);
const branchCreate = z
  .object({
    code: z.string().trim().min(1).max(80),
    name: text,
    priority: z.number().int().nonnegative().optional(),
  })
  .strict();
const warehouseCreate = z
  .object({ branchId: branchIdSchema, code: z.string().trim().min(1).max(80), name: text })
  .strict();

@Controller('/api/v1/admin/organization')
@UseGuards(TenantBearerGuard)
export class TenantAdminController {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(TenantOrganizationMutationAdapter)
    private readonly mutations: TenantOrganizationMutationAdapter,
    @Inject(IDENTITY_CONTRACTS) private readonly identity: IdentityContracts,
    @Inject(ENTITLEMENT_SERVICE) private readonly entitlements: EntitlementServiceContract,
  ) {}
  @Get('branches') async listBranches(@Req() request: AuthenticatedRequest) {
    const principal = this.principal(request);
    const decision = await this.identity.authorize({
      userId: principal.organizationUserId,
      organizationId: principal.organizationId,
      permissionCode: 'users.manage',
      correlationId: correlationIdFor(request),
    });
    if (!decision.allowed) throw PlatformError.permissionDenied();
    return {
      data: await this.db
        .select({
          id: branches.id,
          code: branches.code,
          name: branches.name,
          priority: branches.priority,
          isActive: branches.isActive,
          version: branches.version,
        })
        .from(branches)
        .innerJoin(
          branchAccess,
          and(
            eq(branchAccess.organizationId, branches.organizationId),
            eq(branchAccess.branchId, branches.id),
          ),
        )
        .where(
          and(
            eq(branches.organizationId, principal.organizationId),
            eq(branchAccess.userId, principal.organizationUserId),
          ),
        )
        .orderBy(asc(branches.createdAt)),
    };
  }
  @Post('branches') async createBranch(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const principal = this.principal(request);
    await this.require(principal, request, 'users.manage');
    const input = branchCreate.parse(body);
    const outcome = await this.mutations.createBranch(
      {
        organizationId: principal.organizationId,
        idempotencyScope: this.idempotencyScope(principal, 'branches'),
        idempotencyKey: this.idempotencyKey(request),
        body: input,
      },
      async (tx) => {
        const usage = await tx.$count(
          branches,
          eq(branches.organizationId, principal.organizationId),
        );
        const limit = await this.entitlements.checkLimit(
          principal.organizationId,
          'branches.max',
          usage,
        );
        if (!limit.allowed)
          throw PlatformError.planLimitReached('The branches plan limit has been reached.', {
            details: { ...limit },
          });
      },
    );
    return outcome.body;
  }
  @Get('warehouses') async listWarehouses(@Req() request: AuthenticatedRequest) {
    const principal = this.principal(request);
    await this.require(principal, request, 'users.manage');
    return {
      data: await this.db
        .select({
          id: warehouses.id,
          branchId: warehouses.branchId,
          code: warehouses.code,
          name: warehouses.name,
          isActive: warehouses.isActive,
          version: warehouses.version,
        })
        .from(warehouses)
        .innerJoin(
          branchAccess,
          and(
            eq(branchAccess.organizationId, warehouses.organizationId),
            eq(branchAccess.branchId, warehouses.branchId),
          ),
        )
        .where(
          and(
            eq(warehouses.organizationId, principal.organizationId),
            eq(branchAccess.userId, principal.organizationUserId),
          ),
        )
        .orderBy(asc(warehouses.createdAt)),
    };
  }
  @Post('warehouses') async createWarehouse(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const principal = this.principal(request);
    const input = warehouseCreate.parse(body);
    await this.identity
      .authorize({
        userId: principal.organizationUserId,
        organizationId: principal.organizationId,
        branchId: input.branchId,
        permissionCode: 'users.manage',
        correlationId: correlationIdFor(request),
      })
      .then((decision) => {
        if (!decision.allowed) throw PlatformError.branchAccessDenied();
      });
    const outcome = await this.mutations.createWarehouse(
      {
        organizationId: principal.organizationId,
        idempotencyScope: this.idempotencyScope(principal, 'warehouses'),
        idempotencyKey: this.idempotencyKey(request),
        body: input,
      },
      async (tx) => {
        const usage = await tx.$count(
          warehouses,
          eq(warehouses.organizationId, principal.organizationId),
        );
        const limit = await this.entitlements.checkLimit(
          principal.organizationId,
          'warehouses.max',
          usage,
        );
        if (!limit.allowed)
          throw PlatformError.planLimitReached('The warehouses plan limit has been reached.', {
            details: { ...limit },
          });
      },
    );
    return outcome.body;
  }
  private principal(request: AuthenticatedRequest): OrganizationUserPrincipal {
    if (!request.principal || request.principal.type !== 'ORGANIZATION_USER')
      throw PlatformError.permissionDenied();
    return request.principal as OrganizationUserPrincipal;
  }
  private async require(
    principal: OrganizationUserPrincipal,
    request: AuthenticatedRequest,
    permissionCode: string,
  ) {
    await this.identity
      .authorize({
        userId: principal.organizationUserId,
        organizationId: principal.organizationId,
        permissionCode,
        correlationId: correlationIdFor(request),
      })
      .then((decision) => {
        if (!decision.allowed) throw PlatformError.permissionDenied();
      });
  }
  private idempotencyKey(request: AuthenticatedRequest): string {
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !key.trim() || key.length > 255)
      throw PlatformError.validationFailed('Idempotency-Key is required for mutation requests.', {
        details: { field: 'Idempotency-Key' },
      });
    return key;
  }
  private idempotencyScope(
    principal: OrganizationUserPrincipal,
    resource: 'branches' | 'warehouses',
  ) {
    return `ORGANIZATION_USER:${principal.subjectId}:${principal.organizationId}:POST:/api/v1/admin/organization/${resource}`;
  }
}
