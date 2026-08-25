import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import {
  plans,
  platformTenants,
  subscriptions,
  tenantOverrides,
  newId,
  type DatabaseClient,
} from '@commerce-platform/database';
import { cursorPageRequestSchema, PlatformError, uuidSchema } from '@commerce-platform/contracts';
import { PlatformBearerGuard, type AuthenticatedRequest } from '../../common/auth/http-auth.guards';
import { correlationIdFor } from '../../common/http/correlation';
import { DATABASE } from '../database/database.tokens';
import { PlanService } from '../entitlements/application/plan.service';
import { TenantOverrideRepository } from '../entitlements/infrastructure/tenant-override.repository';
import { ProvisioningRetryRequestService } from '../provisioning/application/provisioning-retry-request.service';
import { TenantProvisioningRepository } from '../provisioning/infrastructure/tenant-provisioning.repository';
import { SubscriptionService } from '../subscriptions/application/subscription.service';
import { PlatformService } from './application/platform.service';
import { PlatformAdminMutationAdapter } from './application/platform-admin-mutation.adapter';
import {
  PLATFORM_AUTHORIZATION,
  type PlatformAuthorizationProvider,
  type PlatformPrincipalContext,
} from './application/platform-authorization.provider';
import type { PlatformUserPrincipal } from '../../common/auth/authenticated-principal';

const id = z.object({ tenantId: uuidSchema });
const planId = z.object({ planId: uuidSchema });
const subscriptionId = z.object({ subscriptionId: uuidSchema });
const text = z.string().trim().min(1).max(200);
const planCreate = z.object({ code: z.string().trim().min(1).max(80), name: text });
const entitlements = z.object({
  entitlements: z.array(z.object({ code: z.string().min(1), value: z.boolean() })).max(100),
});
const limits = z.object({
  limits: z
    .array(z.object({ code: z.string().min(1), value: z.number().int().nonnegative() }))
    .max(100),
});

@Controller('/api/v1/platform')
@UseGuards(PlatformBearerGuard)
export class PlatformAdminController {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(PlatformService) private readonly platform: PlatformService,
    @Inject(PlatformAdminMutationAdapter) private readonly mutations: PlatformAdminMutationAdapter,
    @Inject(PlanService) private readonly planService: PlanService,
    @Inject(SubscriptionService) private readonly subscriptionService: SubscriptionService,
    @Inject(TenantOverrideRepository) private readonly overrides: TenantOverrideRepository,
    @Inject(ProvisioningRetryRequestService)
    private readonly provisioningRetries: ProvisioningRetryRequestService,
    @Inject(TenantProvisioningRepository)
    private readonly provisioningRecords: TenantProvisioningRepository,
    @Inject(PLATFORM_AUTHORIZATION) private readonly authorization: PlatformAuthorizationProvider,
  ) {}
  @Get('tenants') async listTenants(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    await this.require(request, 'tenant.view');
    const page = cursorPageRequestSchema.parse(query);
    if (page.after !== undefined)
      throw PlatformError.validationFailed(
        'Cursor pagination is not supported for this endpoint yet.',
        {
          details: { field: 'after' },
        },
      );
    const rows = await this.db
      .select({
        id: platformTenants.id,
        organizationId: platformTenants.organizationId,
        status: platformTenants.status,
        provisioningStatus: platformTenants.provisioningStatus,
        version: platformTenants.version,
        createdAt: platformTenants.createdAt,
      })
      .from(platformTenants)
      .orderBy(desc(platformTenants.createdAt))
      .limit(page.limit + 1);
    return pageOf(rows, page.limit);
  }
  @Get('tenants/:tenantId') async tenant(
    @Req() request: AuthenticatedRequest,
    @Param() params: unknown,
  ) {
    await this.require(request, 'tenant.view');
    const { tenantId } = id.parse(params);
    const [row] = await this.db
      .select({
        id: platformTenants.id,
        organizationId: platformTenants.organizationId,
        status: platformTenants.status,
        provisioningStatus: platformTenants.provisioningStatus,
        subscriptionId: platformTenants.subscriptionId,
        version: platformTenants.version,
      })
      .from(platformTenants)
      .where(eq(platformTenants.id, tenantId))
      .limit(1);
    if (!row) throw PlatformError.notFound('Platform tenant was not found.');
    return { data: row };
  }
  @Post('tenants') async register(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = z.object({ registrationReference: text }).parse(body);
    return this.mutate(request, 'POST:/api/v1/platform/tenants', input, (tx) =>
      this.platform.registerInTransaction(tx, {
        ...this.audit(request),
        registrationReference: input.registrationReference,
      }),
    );
  }
  @Post('tenants/:tenantId/activate') activate(
    @Req() r: AuthenticatedRequest,
    @Param() p: unknown,
  ) {
    const input = id.parse(p);
    return this.mutate(r, `POST:/api/v1/platform/tenants/${input.tenantId}/activate`, {}, (tx) =>
      this.platform.executeInTransaction(
        tx,
        { ...this.audit(r), ...input },
        'tenant.suspend',
        (t) => t.activate(),
      ),
    );
  }
  @Post('tenants/:tenantId/suspend') suspend(
    @Req() r: AuthenticatedRequest,
    @Param() p: unknown,
    @Body() b: unknown,
  ) {
    const input = { ...id.parse(p), ...z.object({ reason: text }).parse(b) };
    return this.mutate(r, `POST:/api/v1/platform/tenants/${input.tenantId}/suspend`, input, (tx) =>
      this.platform.executeInTransaction(
        tx,
        { ...this.audit(r), ...input },
        'tenant.suspend',
        (t) => t.suspend(input.reason),
      ),
    );
  }
  @Post('tenants/:tenantId/reactivate') reactivate(
    @Req() r: AuthenticatedRequest,
    @Param() p: unknown,
  ) {
    const input = id.parse(p);
    return this.mutate(r, `POST:/api/v1/platform/tenants/${input.tenantId}/reactivate`, {}, (tx) =>
      this.platform.executeInTransaction(
        tx,
        { ...this.audit(r), ...input },
        'tenant.suspend',
        (t) => t.reactivate(),
      ),
    );
  }
  @Post('tenants/:tenantId/close') close(@Req() r: AuthenticatedRequest, @Param() p: unknown) {
    const input = id.parse(p);
    return this.mutate(r, `POST:/api/v1/platform/tenants/${input.tenantId}/close`, {}, (tx) =>
      this.platform.executeInTransaction(
        tx,
        { ...this.audit(r), ...input },
        'tenant.suspend',
        (t) => t.close(),
      ),
    );
  }
  @Get('plans') async listPlans(@Req() r: AuthenticatedRequest) {
    await this.require(r, 'tenant.view');
    return {
      data: await this.db
        .select({
          id: plans.id,
          code: plans.code,
          name: plans.name,
          status: plans.status,
          version: plans.version,
        })
        .from(plans),
    };
  }
  @Post('plans') async createPlan(@Req() r: AuthenticatedRequest, @Body() b: unknown) {
    await this.require(r, 'entitlement.override');
    const input = planCreate.parse(b);
    return this.mutate(r, 'POST:/api/v1/platform/plans', input, (tx) =>
      this.planService.createPlanInTransaction(tx, { ...this.audit(r), ...input }),
    );
  }
  @Get('plans/:planId') async getPlan(@Req() r: AuthenticatedRequest, @Param() p: unknown) {
    await this.require(r, 'tenant.view');
    const [row] = await this.db
      .select()
      .from(plans)
      .where(eq(plans.id, planId.parse(p).planId))
      .limit(1);
    if (!row) throw PlatformError.notFound('Plan was not found.');
    return {
      data: {
        id: row.id,
        code: row.code,
        name: row.name,
        status: row.status,
        version: row.version,
      },
    };
  }
  @Patch('plans/:planId') async updatePlan(
    @Req() r: AuthenticatedRequest,
    @Param() p: unknown,
    @Body() b: unknown,
  ) {
    await this.require(r, 'entitlement.override');
    const input = planCreate
      .partial()
      .extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() })
      .parse(b);
    const common = { ...this.audit(r), ...planId.parse(p) };
    return this.mutate(r, `PATCH:/api/v1/platform/plans/${common.planId}`, input, (tx) =>
      this.planService.executePlanInTransaction(tx, common.planId, common, (plan) => {
        if (input.status === 'ACTIVE') plan.activate();
        else if (input.status === 'INACTIVE') plan.deactivate();
        else plan.update(input);
      }),
    );
  }
  @Put('plans/:planId/entitlements') async setEntitlements(
    @Req() r: AuthenticatedRequest,
    @Param() p: unknown,
    @Body() b: unknown,
  ) {
    await this.require(r, 'entitlement.override');
    const input = entitlements.parse(b);
    const common = { ...this.audit(r), ...planId.parse(p) };
    return this.mutate(r, `PUT:/api/v1/platform/plans/${common.planId}/entitlements`, input, (tx) =>
      this.planService.executePlanInTransaction(tx, common.planId, common, (plan) => {
        for (const entry of input.entitlements) plan.setEntitlement(entry.code, entry.value);
      }),
    );
  }
  @Put('plans/:planId/limits') async setLimits(
    @Req() r: AuthenticatedRequest,
    @Param() p: unknown,
    @Body() b: unknown,
  ) {
    await this.require(r, 'entitlement.override');
    const input = limits.parse(b);
    const common = { ...this.audit(r), ...planId.parse(p) };
    return this.mutate(r, `PUT:/api/v1/platform/plans/${common.planId}/limits`, input, (tx) =>
      this.planService.executePlanInTransaction(tx, common.planId, common, (plan) => {
        for (const entry of input.limits) plan.setLimit(entry.code, entry.value);
      }),
    );
  }
  @Get('subscriptions') async listSubscriptions(@Req() r: AuthenticatedRequest) {
    await this.require(r, 'tenant.view');
    return {
      data: await this.db
        .select({
          id: subscriptions.id,
          organizationId: subscriptions.organizationId,
          planId: subscriptions.planId,
          status: subscriptions.status,
          billingCycle: subscriptions.billingCycle,
          version: subscriptions.version,
        })
        .from(subscriptions),
    };
  }
  @Get('subscriptions/:subscriptionId') async getSubscription(
    @Req() r: AuthenticatedRequest,
    @Param() p: unknown,
  ) {
    await this.require(r, 'tenant.view');
    const [row] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId.parse(p).subscriptionId))
      .limit(1);
    if (!row) throw PlatformError.notFound('Subscription was not found.');
    return { data: row };
  }
  @Post('subscriptions/:subscriptionId/change-plan') async changePlan(
    @Req() r: AuthenticatedRequest,
    @Param() p: unknown,
    @Body() b: unknown,
  ) {
    await this.require(r, 'subscription.change');
    const subscriptionIdValue = subscriptionId.parse(p).subscriptionId;
    const input = z.object({ planId: uuidSchema, effectiveAt: z.iso.datetime() }).parse(b);
    const organizationId = await this.subscriptionOrganization(subscriptionIdValue);
    return this.mutate(
      r,
      `POST:/api/v1/platform/subscriptions/${subscriptionIdValue}/change-plan`,
      input,
      (tx) =>
        this.subscriptionService.executeInTransaction(
          tx,
          {
            ...this.audit(r),
            subscriptionId: subscriptionIdValue,
            organizationId,
          },
          (subscription) =>
            subscription.changePlan({
              planId: input.planId,
              effectiveAt: new Date(input.effectiveAt),
              periodId: newId(),
            }),
        ),
    );
  }
  @Post('subscriptions/:subscriptionId/extend-trial') async extendTrial(
    @Req() r: AuthenticatedRequest,
    @Param() p: unknown,
    @Body() b: unknown,
  ) {
    await this.require(r, 'subscription.change');
    const subscriptionIdValue = subscriptionId.parse(p).subscriptionId;
    const input = z.object({ trialEndsAt: z.iso.datetime() }).parse(b);
    const organizationId = await this.subscriptionOrganization(subscriptionIdValue);
    return this.mutate(
      r,
      `POST:/api/v1/platform/subscriptions/${subscriptionIdValue}/extend-trial`,
      input,
      (tx) =>
        this.subscriptionService.executeInTransaction(
          tx,
          {
            ...this.audit(r),
            subscriptionId: subscriptionIdValue,
            organizationId,
          },
          (subscription) =>
            subscription.extendTrial({
              trialEndsAt: new Date(input.trialEndsAt),
              periodId: newId(),
            }),
        ),
    );
  }
  @Post('subscriptions/:subscriptionId/schedule-cancellation') async cancel(
    @Req() r: AuthenticatedRequest,
    @Param() p: unknown,
  ) {
    await this.require(r, 'subscription.change');
    const subscriptionIdValue = subscriptionId.parse(p).subscriptionId;
    const organizationId = await this.subscriptionOrganization(subscriptionIdValue);
    return this.mutate(
      r,
      `POST:/api/v1/platform/subscriptions/${subscriptionIdValue}/schedule-cancellation`,
      {},
      (tx) =>
        this.subscriptionService.executeInTransaction(
          tx,
          {
            ...this.audit(r),
            subscriptionId: subscriptionIdValue,
            organizationId,
          },
          (subscription) => subscription.scheduleCancellation(),
        ),
    );
  }
  @Post('subscriptions/:subscriptionId/reactivate') async reactivateSubscription(
    @Req() r: AuthenticatedRequest,
    @Param() p: unknown,
  ) {
    await this.require(r, 'subscription.change');
    const subscriptionIdValue = subscriptionId.parse(p).subscriptionId;
    const organizationId = await this.subscriptionOrganization(subscriptionIdValue);
    return this.mutate(
      r,
      `POST:/api/v1/platform/subscriptions/${subscriptionIdValue}/reactivate`,
      {},
      (tx) =>
        this.subscriptionService.executeInTransaction(
          tx,
          {
            ...this.audit(r),
            subscriptionId: subscriptionIdValue,
            organizationId,
          },
          (subscription) => subscription.reactivate(),
        ),
    );
  }
  @Get('tenants/:tenantId/entitlements') async listOverrides(
    @Req() r: AuthenticatedRequest,
    @Param() p: unknown,
  ) {
    await this.require(r, 'tenant.view');
    const tenant = await this.tenantOrganization(id.parse(p).tenantId);
    return {
      data: await this.db
        .select({
          id: tenantOverrides.id,
          code: tenantOverrides.code,
          value: tenantOverrides.valueJson,
          effectiveFrom: tenantOverrides.effectiveFrom,
          effectiveTo: tenantOverrides.effectiveTo,
          reason: tenantOverrides.reason,
          actorType: tenantOverrides.actorType,
          actorId: tenantOverrides.actorId,
        })
        .from(tenantOverrides)
        .where(eq(tenantOverrides.organizationId, tenant)),
    };
  }
  @Post('tenants/:tenantId/entitlement-overrides') async grantOverride(
    @Req() r: AuthenticatedRequest,
    @Param() p: unknown,
    @Body() b: unknown,
  ) {
    await this.require(r, 'entitlement.override');
    const tenantId = id.parse(p).tenantId;
    const organizationId = await this.tenantOrganization(tenantId);
    const input = z
      .object({
        code: text,
        value: z.union([z.boolean(), z.number().int().nonnegative()]),
        effectiveFrom: z.iso.datetime(),
        effectiveTo: z.iso.datetime().nullable().optional(),
        reason: text,
      })
      .parse(b);
    const audit = this.audit(r);
    return this.mutate(
      r,
      `POST:/api/v1/platform/tenants/${tenantId}/entitlement-overrides`,
      input,
      (tx) =>
        this.planService.grantTenantEntitlementOverrideInTransaction(tx, {
          ...audit,
          organizationId,
          ...input,
          effectiveFrom: new Date(input.effectiveFrom),
          effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
          actorType: 'PLATFORM_USER',
          actorId: audit.actorId,
        }),
    );
  }
  @Delete('tenants/:tenantId/entitlement-overrides/:overrideId') async revokeOverride(
    @Req() r: AuthenticatedRequest,
    @Param() p: unknown,
  ) {
    await this.require(r, 'entitlement.override');
    const params = z.object({ tenantId: uuidSchema, overrideId: uuidSchema }).parse(p);
    const organizationId = await this.tenantOrganization(params.tenantId);
    return this.mutate(
      r,
      `DELETE:/api/v1/platform/tenants/${params.tenantId}/entitlement-overrides/${params.overrideId}`,
      {},
      (tx) =>
        this.planService.revokeTenantEntitlementOverrideInTransaction(tx, {
          ...this.audit(r),
          organizationId,
          overrideId: params.overrideId,
        }),
    );
  }
  @Get('tenants/:tenantId/provisioning') async status(
    @Req() r: AuthenticatedRequest,
    @Param() p: unknown,
  ) {
    await this.require(r, 'tenant.view');
    const record = await this.provisioningRecords.find(this.db, id.parse(p).tenantId);
    if (!record) throw PlatformError.notFound('Provisioning record was not found.');
    return { data: record };
  }
  @Post('tenants/:tenantId/provisioning/retry') async retry(
    @Req() r: AuthenticatedRequest,
    @Param() p: unknown,
    @Body() b: unknown,
  ) {
    await this.require(r, 'tenant.suspend');
    const tenantId = id.parse(p).tenantId;
    const input = z.object({ registrationReference: text }).parse(b);
    const key = r.headers['idempotency-key'];
    if (typeof key !== 'string' || !key.trim() || key.length > 255)
      throw PlatformError.validationFailed('Idempotency-Key is required for mutation requests.', {
        details: { field: 'Idempotency-Key' },
      });
    const audit = this.audit(r);
    return data(
      await this.provisioningRetries.request({
        tenantId,
        organizationId: await this.tenantOrganization(tenantId),
        registrationReference: input.registrationReference,
        idempotencyScope: `${audit.principal.type}:${audit.principal.subjectId}:POST:/api/v1/platform/tenants/${tenantId}/provisioning/retry`,
        idempotencyKey: key,
        actorId: audit.actorId,
        correlationId: audit.correlationId,
        causationId: tenantId,
      }),
    );
  }
  private audit(request: AuthenticatedRequest): PlatformPrincipalContext & { actorId: string } {
    const principal = request.principal;
    if (!principal || principal.type !== 'PLATFORM_USER') throw PlatformError.permissionDenied();
    const platformPrincipal = principal as PlatformUserPrincipal;
    return {
      principal: platformPrincipal,
      actorId: platformPrincipal.platformUserId,
      correlationId: correlationIdFor(request),
      causationId: correlationIdFor(request),
    };
  }
  private require(
    request: AuthenticatedRequest,
    capability: Parameters<PlatformAuthorizationProvider['requireCapability']>[1],
  ) {
    return this.authorization.requireCapability(this.audit(request), capability);
  }
  private async tenantOrganization(tenantId: string) {
    const [tenant] = await this.db
      .select({ organizationId: platformTenants.organizationId })
      .from(platformTenants)
      .where(eq(platformTenants.id, tenantId))
      .limit(1);
    if (!tenant) throw PlatformError.notFound('Platform tenant was not found.');
    return tenant.organizationId;
  }
  private async subscriptionOrganization(subscriptionIdValue: string) {
    const [subscription] = await this.db
      .select({ organizationId: subscriptions.organizationId })
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionIdValue))
      .limit(1);
    if (!subscription) throw PlatformError.notFound('Subscription was not found.');
    return subscription.organizationId;
  }
  private mutate<T>(
    request: AuthenticatedRequest,
    route: string,
    body: unknown,
    command: Parameters<PlatformAdminMutationAdapter['execute']>[1],
  ) {
    const audit = this.audit(request);
    return this.mutations
      .execute(
        {
          scope: `${audit.principal.type}:${audit.principal.subjectId}:${route}`,
          key: this.idempotencyKey(request),
          body,
        },
        command as (tx: import('./infrastructure/db-executor').DbExecutor) => Promise<T>,
      )
      .then((outcome) => outcome.body);
  }
  private idempotencyKey(request: AuthenticatedRequest) {
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !key.trim() || key.length > 255)
      throw PlatformError.validationFailed('Idempotency-Key is required for mutation requests.', {
        details: { field: 'Idempotency-Key' },
      });
    return key;
  }
}
function data<T>(value: T) {
  return { data: value };
}
function pageOf<T>(rows: T[], limit: number) {
  return { data: rows.slice(0, limit), page: { hasMore: rows.length > limit, nextCursor: null } };
}
