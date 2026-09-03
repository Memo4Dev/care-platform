import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PlatformError } from '@commerce-platform/contracts';
import { z } from 'zod';

import { TenantBearerGuard, type AuthenticatedRequest } from '../../common/auth/http-auth.guards';
import type { OrganizationUserPrincipal } from '../../common/auth/authenticated-principal';
import { correlationIdFor } from '../../common/http/correlation';
import { IDENTITY_CONTRACTS, type IdentityContracts } from '../identity/contracts';
import { CustomerService } from './application/customer.service';

const createCustomer = z
  .object({
    type: z.enum(['INDIVIDUAL', 'BUSINESS']),
    displayName: z.string().trim().min(1).max(200),
    code: z.string().trim().min(1).max(64).optional().nullable(),
    phone: z.string().trim().max(50).optional().nullable(),
    email: z.string().email().max(254).optional().nullable(),
  })
  .strict();

const searchCustomers = z.object({
  q: z.string().trim().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const customerResponseSchema = {
  type: 'object',
  required: [
    'id',
    'organizationId',
    'type',
    'displayName',
    'code',
    'createdAt',
    'updatedAt',
    'version',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string', format: 'uuid' },
    type: { type: 'string', enum: ['INDIVIDUAL', 'BUSINESS'] },
    displayName: { type: 'string' },
    code: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    version: { type: 'integer', minimum: 1 },
  },
};

@Controller('/api/v1/admin/customers')
@UseGuards(TenantBearerGuard)
@ApiTags('Customers')
@ApiBearerAuth('platform-bearer')
export class CustomersAdminController {
  constructor(
    @Inject(CustomerService) private readonly customers: CustomerService,
    @Inject(IDENTITY_CONTRACTS) private readonly identity: IdentityContracts,
  ) {}

  @Get('search')
  @ApiOperation({ summary: 'Search business customers for POS sales' })
  @ApiQuery({ name: 'q', required: false, type: String, description: 'Name, code, or phone' })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiResponse({
    status: 200,
    description: 'Organization-scoped customer search results',
    schema: {
      type: 'object',
      required: ['data'],
      properties: { data: { type: 'array', items: customerResponseSchema } },
    },
  })
  @ApiResponse({ status: 401, description: 'Authentication required or credentials invalid' })
  @ApiResponse({ status: 403, description: 'sales.create permission required' })
  @ApiResponse({ status: 422, description: 'Invalid search parameters' })
  async search(
    @Req() request: AuthenticatedRequest,
    @Query('q') q = '',
    @Query('limit') limit = '20',
  ) {
    const principal = await this.authorize(request);
    const query = searchCustomers.parse({ q, limit });
    const rows = await this.customers.search(principal.organizationId, query.q, query.limit);
    return { data: rows.map(toJson) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an organization-scoped business customer' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Customer found',
    schema: {
      type: 'object',
      required: ['data'],
      properties: { data: customerResponseSchema },
    },
  })
  @ApiResponse({ status: 401, description: 'Authentication required or credentials invalid' })
  @ApiResponse({ status: 403, description: 'sales.create permission required' })
  @ApiResponse({ status: 404, description: 'Customer not found in tenant' })
  async get(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const principal = await this.authorize(request);
    const customerId = z.string().uuid().parse(id);
    const row = await this.customers.get(principal.organizationId, customerId);
    if (!row) throw PlatformError.notFound('Customer not found.');
    return { data: toJson(row) };
  }

  @Post()
  @ApiOperation({ summary: 'Create an Individual or Business customer' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Stable key for safely retrying this local atomic mutation',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'displayName'],
      properties: {
        type: { type: 'string', enum: ['INDIVIDUAL', 'BUSINESS'] },
        displayName: { type: 'string', minLength: 1, maxLength: 200 },
        code: { type: 'string', nullable: true, maxLength: 64 },
        phone: { type: 'string', nullable: true, maxLength: 50 },
        email: { type: 'string', format: 'email', nullable: true, maxLength: 254 },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Customer created',
    schema: {
      type: 'object',
      required: ['data'],
      properties: { data: customerResponseSchema },
    },
  })
  @ApiResponse({ status: 401, description: 'Authentication required or credentials invalid' })
  @ApiResponse({ status: 403, description: 'sales.create permission required' })
  @ApiResponse({ status: 409, description: 'Idempotency conflict' })
  @ApiResponse({ status: 422, description: 'Validation error or missing Idempotency-Key' })
  async create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const principal = await this.authorize(request);
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !key.trim() || key.length > 255) {
      throw PlatformError.validationFailed(
        'Idempotency-Key is required and must be at most 255 characters.',
        {
          details: { field: 'Idempotency-Key' },
        },
      );
    }
    const input = createCustomer.parse(body);
    const row = await this.customers.create(
      principal.organizationId,
      input,
      key.trim(),
      principal.organizationUserId,
      correlationIdFor(request),
    );
    return { data: toJson(row) };
  }

  private async authorize(request: AuthenticatedRequest): Promise<OrganizationUserPrincipal> {
    if (!request.principal || request.principal.type !== 'ORGANIZATION_USER')
      throw PlatformError.permissionDenied();
    const principal = request.principal as OrganizationUserPrincipal;
    const decision = await this.identity.authorize({
      userId: principal.organizationUserId,
      organizationId: principal.organizationId,
      permissionCode: 'sales.create',
      correlationId: correlationIdFor(request),
    });
    if (!decision.allowed) throw PlatformError.permissionDenied();
    return principal;
  }
}

function toJson(row: {
  id: string;
  organizationId: string;
  type: string;
  displayName: string;
  code: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    type: row.type,
    displayName: row.displayName,
    code: row.code,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}
