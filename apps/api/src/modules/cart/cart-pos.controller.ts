import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
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
import { cursorPageRequestSchema, PlatformError } from '@commerce-platform/contracts';
import { z } from 'zod';

import { PosOperatorGuard, type AuthenticatedRequest } from '../../common/auth/http-auth.guards';
import {
  assertTrustedOrganizationUserPrincipal,
  type OrganizationUserPrincipal,
} from '../../common/auth/authenticated-principal';
import { correlationIdFor } from '../../common/http/correlation';
import { IDENTITY_CONTRACTS, type IdentityContracts } from '../identity/contracts';
import { CartService, requestHash } from './application/cart.service';

const uuid = z.string().uuid();
const createCart = z
  .object({
    branchId: uuid,
    customerId: uuid.optional().nullable(),
  })
  .strict();

const addItem = z
  .object({
    variantId: uuid,
    unitId: uuid,
    quantity: z.string().trim().min(1).max(15),
  })
  .strict();

const updateItem = z.object({ quantity: z.string().trim().min(1).max(15) }).strict();

const noBody = z.undefined();

const listCarts = z.object({ branchId: uuid }).merge(cursorPageRequestSchema).strict();

/** OpenAPI documents the same positive, bounded decimal accepted by the domain. */
export const CART_QUANTITY_REQUEST_SCHEMA = {
  type: 'string' as const,
  minLength: 1,
  maxLength: 15,
  pattern: '^(?:0\\.(?!0+$)[0-9]{1,8}|[1-9][0-9]{0,5}(?:\\.[0-9]{1,8})?)$',
  description: 'Positive decimal quantity with up to 8 fractional digits; maximum 999999.99999999.',
  example: '2.50000000',
};

/** Cart responses are normalized to exactly eight fractional places. */
export const CART_QUANTITY_RESPONSE_SCHEMA = {
  type: 'string' as const,
  minLength: 10,
  maxLength: 15,
  pattern: '^(?:0\\.(?!0+$)[0-9]{8}|[1-9][0-9]{0,5}\\.[0-9]{8})$',
  description: 'Positive decimal quantity normalized to eight fractional digits.',
  example: '2.50000000',
};

const createCartRequest = {
  type: 'object',
  additionalProperties: false,
  required: ['branchId'],
  properties: {
    branchId: { type: 'string', format: 'uuid' },
    customerId: { type: 'string', format: 'uuid', nullable: true },
  },
};

const addItemRequest = {
  type: 'object',
  additionalProperties: false,
  required: ['variantId', 'unitId', 'quantity'],
  properties: {
    variantId: { type: 'string', format: 'uuid' },
    unitId: { type: 'string', format: 'uuid' },
    quantity: CART_QUANTITY_REQUEST_SCHEMA,
  },
};

const updateItemRequest = {
  type: 'object',
  additionalProperties: false,
  required: ['quantity'],
  properties: { quantity: CART_QUANTITY_REQUEST_SCHEMA },
};

const cartItemResponse = {
  type: 'object',
  required: [
    'id',
    'organizationId',
    'cartId',
    'variantId',
    'unitId',
    'quantity',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string', format: 'uuid' },
    cartId: { type: 'string', format: 'uuid' },
    variantId: { type: 'string', format: 'uuid' },
    unitId: { type: 'string', format: 'uuid' },
    quantity: CART_QUANTITY_RESPONSE_SCHEMA,
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const cartResponse = {
  type: 'object',
  required: [
    'id',
    'organizationId',
    'branchId',
    'channel',
    'status',
    'customerId',
    'createdAt',
    'updatedAt',
    'version',
    'items',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string', format: 'uuid' },
    branchId: { type: 'string', format: 'uuid' },
    channel: { type: 'string', enum: ['ONLINE', 'POS', 'SALES'] },
    status: { type: 'string', enum: ['DRAFT'] },
    customerId: { type: 'string', format: 'uuid', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    version: { type: 'integer', minimum: 1 },
    items: { type: 'array', items: cartItemResponse },
  },
};

const errorEnvelope = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'correlationId'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: { type: 'object', additionalProperties: true },
        correlationId: { type: 'string' },
      },
    },
  },
};

const cartSuccess = {
  type: 'object',
  required: ['data'],
  properties: { data: cartResponse },
};

const cartPageResponse = {
  type: 'object',
  required: ['data', 'page'],
  properties: {
    data: { type: 'array', items: cartResponse },
    page: {
      type: 'object',
      required: ['nextCursor', 'hasMore'],
      properties: {
        nextCursor: { type: 'string', nullable: true },
        hasMore: { type: 'boolean' },
      },
    },
  },
};

@Controller('/api/v1/pos/carts')
@UseGuards(PosOperatorGuard)
@ApiTags('POS Cart')
@ApiBearerAuth('tenant-bearer')
export class CartPosController {
  constructor(
    @Inject(CartService) private readonly carts: CartService,
    @Inject(IDENTITY_CONTRACTS) private readonly identity: IdentityContracts,
  ) {}

  /** Reads are NOT_REQUIRED for idempotency; the branch is still authorized. */
  @Get()
  @ApiOperation({ summary: 'List POS Draft Carts for an authorized branch' })
  @ApiQuery({ name: 'branchId', required: true, type: String, format: 'uuid' })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 200 })
  @ApiQuery({
    name: 'after',
    required: false,
    type: String,
    description: 'Opaque next-page cursor',
  })
  @ApiResponse({
    status: 200,
    description: 'Organization and branch scoped POS Draft Carts',
    schema: cartPageResponse,
  })
  @ApiResponse({ status: 401, description: 'Authentication required', schema: errorEnvelope })
  @ApiResponse({
    status: 403,
    description: 'sales.create permission or branch access required',
    schema: errorEnvelope,
  })
  @ApiResponse({
    status: 422,
    description: 'Invalid branch, limit, or cursor',
    schema: errorEnvelope,
  })
  async list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const principal = this.principal(request);
    const input = listCarts.parse(query);
    await this.requireBranch(principal, request, input.branchId);
    const page = await this.carts.list(
      principal.organizationId,
      input.branchId,
      input.limit,
      input.after,
    );
    return {
      data: page.items,
      page: { nextCursor: page.nextCursor ?? null, hasMore: page.hasMore },
    };
  }

  /** Reads are NOT_REQUIRED for idempotency; the Cart is tenant and branch scoped. */
  @Get(':cartId')
  @ApiOperation({ summary: 'Get one organization-scoped POS Draft Cart' })
  @ApiParam({ name: 'cartId', type: String, format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Cart found',
    schema: cartSuccess,
  })
  @ApiResponse({ status: 401, description: 'Authentication required', schema: errorEnvelope })
  @ApiResponse({
    status: 403,
    description: 'sales.create permission or branch access required',
    schema: errorEnvelope,
  })
  @ApiResponse({ status: 404, description: 'Cart not found in tenant', schema: errorEnvelope })
  @ApiResponse({ status: 422, description: 'Invalid Cart ID', schema: errorEnvelope })
  async get(@Req() request: AuthenticatedRequest, @Param('cartId') cartId: string) {
    const principal = this.principal(request);
    const id = uuid.parse(cartId);
    const cart = await this.requireCart(principal, id);
    await this.requireBranch(principal, request, cart.branchId);
    return { data: cart };
  }

  /** Idempotency classification: LOCAL_ATOMIC. */
  @Post()
  @ApiOperation({ summary: 'Create an empty POS Draft Cart' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: createCartRequest })
  @ApiResponse({
    status: 201,
    description: 'Cart created',
    schema: cartSuccess,
  })
  @ApiResponse({ status: 401, description: 'Authentication required', schema: errorEnvelope })
  @ApiResponse({
    status: 403,
    description: 'sales.create permission or branch access required',
    schema: errorEnvelope,
  })
  @ApiResponse({
    status: 404,
    description: 'Branch or Customer reference not found in tenant',
    schema: errorEnvelope,
  })
  @ApiResponse({
    status: 409,
    description: 'Idempotency or concurrency conflict',
    schema: errorEnvelope,
  })
  @ApiResponse({
    status: 422,
    description: 'Invalid body or missing Idempotency-Key',
    schema: errorEnvelope,
  })
  async create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const principal = this.principal(request);
    const input = createCart.parse(body);
    const executionInput = {
      branchId: input.branchId,
      customerId: input.customerId ?? null,
    };
    await this.requireBranch(principal, request, input.branchId);
    const idempotencyKey = this.requireIdempotencyKey(request);
    const cart = await this.carts.create(
      {
        organizationId: principal.organizationId,
        ...executionInput,
      },
      this.context(principal, request, idempotencyKey, requestHash(executionInput)),
    );
    return { data: cart };
  }

  /** Idempotency classification: LOCAL_ATOMIC. */
  @Post(':cartId/items')
  @HttpCode(200)
  @ApiOperation({ summary: 'Add or merge an item in a POS Draft Cart' })
  @ApiParam({ name: 'cartId', type: String, format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'Cart version expected by the command',
  })
  @ApiBody({ schema: addItemRequest })
  @ApiResponse({
    status: 200,
    description: 'Item added and Cart version advanced',
    schema: cartSuccess,
  })
  @ApiResponse({ status: 401, description: 'Authentication required', schema: errorEnvelope })
  @ApiResponse({
    status: 403,
    description: 'sales.create permission or branch access required',
    schema: errorEnvelope,
  })
  @ApiResponse({ status: 404, description: 'Cart not found in tenant', schema: errorEnvelope })
  @ApiResponse({
    status: 409,
    description: 'Idempotency or version conflict',
    schema: errorEnvelope,
  })
  @ApiResponse({
    status: 422,
    description: 'Invalid body, headers, or Cart ID',
    schema: errorEnvelope,
  })
  async addItem(
    @Req() request: AuthenticatedRequest,
    @Param('cartId') cartId: string,
    @Body() body: unknown,
  ) {
    const principal = this.principal(request);
    const id = uuid.parse(cartId);
    const cart = await this.requireCart(principal, id);
    await this.requireBranch(principal, request, cart.branchId);
    const input = addItem.parse(body);
    const idempotencyKey = this.requireIdempotencyKey(request);
    const expectedVersion = this.requireVersion(request);
    const result = await this.carts.addItem(
      {
        organizationId: principal.organizationId,
        cartId: id,
        ...input,
        expectedVersion,
      },
      this.context(
        principal,
        request,
        idempotencyKey,
        requestHash({ cartId: id, ...input, expectedVersion }),
      ),
    );
    return { data: result };
  }

  /** Idempotency classification: LOCAL_ATOMIC. */
  @Patch(':cartId/items/:itemId')
  @ApiOperation({ summary: 'Update an item quantity in a POS Draft Cart' })
  @ApiParam({ name: 'cartId', type: String, format: 'uuid' })
  @ApiParam({ name: 'itemId', type: String, format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'Cart version expected by the command',
  })
  @ApiBody({ schema: updateItemRequest })
  @ApiResponse({
    status: 200,
    description: 'Item updated and Cart version advanced',
    schema: cartSuccess,
  })
  @ApiResponse({ status: 401, description: 'Authentication required', schema: errorEnvelope })
  @ApiResponse({
    status: 403,
    description: 'sales.create permission or branch access required',
    schema: errorEnvelope,
  })
  @ApiResponse({ status: 404, description: 'Cart or Cart item not found', schema: errorEnvelope })
  @ApiResponse({
    status: 409,
    description: 'Idempotency or version conflict',
    schema: errorEnvelope,
  })
  @ApiResponse({
    status: 422,
    description: 'Invalid body, headers, or Cart ID',
    schema: errorEnvelope,
  })
  async updateItem(
    @Req() request: AuthenticatedRequest,
    @Param('cartId') cartId: string,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ) {
    const principal = this.principal(request);
    const cartIdValue = uuid.parse(cartId);
    const itemIdValue = uuid.parse(itemId);
    const cart = await this.requireCart(principal, cartIdValue);
    await this.requireBranch(principal, request, cart.branchId);
    const input = updateItem.parse(body);
    const idempotencyKey = this.requireIdempotencyKey(request);
    const expectedVersion = this.requireVersion(request);
    const result = await this.carts.updateItem(
      {
        organizationId: principal.organizationId,
        cartId: cartIdValue,
        itemId: itemIdValue,
        quantity: input.quantity,
        expectedVersion,
      },
      this.context(
        principal,
        request,
        idempotencyKey,
        requestHash({ cartId: cartIdValue, itemId: itemIdValue, ...input, expectedVersion }),
      ),
    );
    return { data: result };
  }

  /** Idempotency classification: LOCAL_ATOMIC. */
  @Delete(':cartId/items/:itemId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove an item from a POS Draft Cart' })
  @ApiParam({ name: 'cartId', type: String, format: 'uuid' })
  @ApiParam({ name: 'itemId', type: String, format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'Cart version expected by the command',
  })
  @ApiResponse({
    status: 200,
    description: 'Item removed and Cart version advanced',
    schema: cartSuccess,
  })
  @ApiResponse({ status: 401, description: 'Authentication required', schema: errorEnvelope })
  @ApiResponse({
    status: 403,
    description: 'sales.create permission or branch access required',
    schema: errorEnvelope,
  })
  @ApiResponse({ status: 404, description: 'Cart or Cart item not found', schema: errorEnvelope })
  @ApiResponse({
    status: 409,
    description: 'Idempotency or version conflict',
    schema: errorEnvelope,
  })
  @ApiResponse({ status: 422, description: 'Invalid headers or Cart ID', schema: errorEnvelope })
  async removeItem(
    @Req() request: AuthenticatedRequest,
    @Param('cartId') cartId: string,
    @Param('itemId') itemId: string,
  ) {
    noBody.parse(request.body);
    const principal = this.principal(request);
    const cartIdValue = uuid.parse(cartId);
    const itemIdValue = uuid.parse(itemId);
    const cart = await this.requireCart(principal, cartIdValue);
    await this.requireBranch(principal, request, cart.branchId);
    const idempotencyKey = this.requireIdempotencyKey(request);
    const expectedVersion = this.requireVersion(request);
    const result = await this.carts.removeItem(
      {
        organizationId: principal.organizationId,
        cartId: cartIdValue,
        itemId: itemIdValue,
        expectedVersion,
      },
      this.context(
        principal,
        request,
        idempotencyKey,
        requestHash({ cartId: cartIdValue, itemId: itemIdValue, expectedVersion }),
      ),
    );
    return { data: result };
  }

  /** Idempotency classification: LOCAL_ATOMIC. */
  @Post(':cartId/save')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Durably save the current POS Draft Cart snapshot without changing it',
  })
  @ApiParam({ name: 'cartId', type: String, format: 'uuid' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'Cart version expected by the save command',
  })
  @ApiResponse({
    status: 200,
    description: 'Durable Cart snapshot saved without changing Cart state or version',
    schema: cartSuccess,
  })
  @ApiResponse({ status: 401, description: 'Authentication required', schema: errorEnvelope })
  @ApiResponse({
    status: 403,
    description: 'sales.create permission or branch access required',
    schema: errorEnvelope,
  })
  @ApiResponse({ status: 404, description: 'Cart not found in tenant', schema: errorEnvelope })
  @ApiResponse({
    status: 409,
    description: 'Idempotency or Cart version conflict',
    schema: errorEnvelope,
  })
  @ApiResponse({
    status: 422,
    description: 'Request body is not allowed, or required headers or Cart ID are invalid',
    schema: errorEnvelope,
  })
  async save(@Req() request: AuthenticatedRequest, @Param('cartId') cartId: string) {
    noBody.parse(request.body);
    const principal = this.principal(request);
    const cartIdValue = uuid.parse(cartId);
    const cart = await this.requireCart(principal, cartIdValue);
    await this.requireBranch(principal, request, cart.branchId);
    const idempotencyKey = this.requireIdempotencyKey(request);
    const expectedVersion = this.requireVersion(request);
    const result = await this.carts.save(
      {
        organizationId: principal.organizationId,
        cartId: cartIdValue,
        expectedVersion,
      },
      this.context(
        principal,
        request,
        idempotencyKey,
        requestHash({ cartId: cartIdValue, expectedVersion }),
      ),
    );
    return { data: result };
  }

  private principal(request: AuthenticatedRequest): OrganizationUserPrincipal {
    const principal = request.principal;
    assertTrustedOrganizationUserPrincipal(principal);
    return principal;
  }

  private async requireCart(principal: OrganizationUserPrincipal, cartId: string) {
    const cart = await this.carts.get(principal.organizationId, cartId);
    if (!cart) throw PlatformError.notFound('Cart not found.');
    return cart;
  }

  private async requireBranch(
    principal: OrganizationUserPrincipal,
    request: AuthenticatedRequest,
    branchId: string,
  ): Promise<void> {
    const decision = await this.identity.authorize({
      userId: principal.organizationUserId,
      organizationId: principal.organizationId,
      permissionCode: 'sales.create',
      branchId,
      correlationId: correlationIdFor(request),
    });
    if (decision.allowed) return;
    if (decision.reason === 'BRANCH_SCOPE_EXCLUDED') {
      throw PlatformError.branchAccessDenied('Branch access denied.', { details: { branchId } });
    }
    throw PlatformError.permissionDenied('Permission sales.create denied.');
  }

  private requireIdempotencyKey(request: AuthenticatedRequest): string {
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !key.trim() || key.length > 255) {
      throw PlatformError.validationFailed(
        'Idempotency-Key is required and must be at most 255 characters.',
        { details: { field: 'Idempotency-Key' } },
      );
    }
    return key.trim();
  }

  private requireVersion(request: AuthenticatedRequest): number {
    const value = request.headers['if-match'];
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
      throw PlatformError.validationFailed('If-Match must contain the expected Cart version.', {
        details: { field: 'If-Match' },
      });
    }
    const version = Number(value);
    if (!Number.isSafeInteger(version) || version < 1) {
      throw PlatformError.validationFailed('If-Match must contain the expected Cart version.', {
        details: { field: 'If-Match' },
      });
    }
    return version;
  }

  private context(
    principal: OrganizationUserPrincipal,
    request: AuthenticatedRequest,
    idempotencyKey: string,
    hash: string,
  ) {
    return {
      organizationId: principal.organizationId,
      actorId: principal.organizationUserId,
      correlationId: correlationIdFor(request),
      idempotencyKey,
      requestHash: hash,
    };
  }
}
