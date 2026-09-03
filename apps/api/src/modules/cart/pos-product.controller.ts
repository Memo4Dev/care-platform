import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PlatformError } from '@commerce-platform/contracts';
import { z } from 'zod';

import { PosOperatorGuard, type AuthenticatedRequest } from '../../common/auth/http-auth.guards';
import {
  assertTrustedOrganizationUserPrincipal,
  type OrganizationUserPrincipal,
} from '../../common/auth/authenticated-principal';
import { correlationIdFor } from '../../common/http/correlation';
import { CATALOG_CONTRACTS, type CatalogContracts } from '../catalog/contracts';
import { IDENTITY_CONTRACTS, type IdentityContracts } from '../identity/contracts';

const uuid = z.string().uuid();
const barcodeParam = z.string().trim().min(1).max(100);

const barcodeScanResponse = {
  type: 'object',
  required: [
    'barcode',
    'variantId',
    'productId',
    'productName',
    'variantName',
    'sku',
    'baseUnitId',
    'sellable',
  ],
  properties: {
    barcode: { type: 'string' },
    variantId: { type: 'string', format: 'uuid' },
    productId: { type: 'string', format: 'uuid' },
    productName: { type: 'string' },
    variantName: { type: 'string' },
    sku: { type: 'string' },
    baseUnitId: { type: 'string', format: 'uuid' },
    sellable: { type: 'boolean' },
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

/**
 * Compact POS-facing product lookups (currently barcode scan). These are
 * read-only helpers for a POS operator adding items to a Cart; they resolve
 * through the Catalog module contract and enforce the same POS operator +
 * `sales.create` + branch authorization as the Cart surface.
 */
@Controller('/api/v1/pos/products')
@UseGuards(PosOperatorGuard)
@ApiTags('POS Products')
@ApiBearerAuth('tenant-bearer')
export class PosProductController {
  constructor(
    @Inject(CATALOG_CONTRACTS) private readonly catalog: CatalogContracts,
    @Inject(IDENTITY_CONTRACTS) private readonly identity: IdentityContracts,
  ) {}

  /** Reads are NOT_REQUIRED for idempotency; the branch is still authorized. */
  @Get('barcode/:barcode')
  @ApiOperation({ summary: 'Resolve a scanned barcode to a sellable variant for the POS' })
  @ApiParam({ name: 'barcode', type: String, description: 'Barcode string to resolve' })
  @ApiQuery({ name: 'branchId', required: true, type: String, format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Barcode resolved', schema: barcodeScanResponse })
  @ApiResponse({ status: 401, description: 'Authentication required', schema: errorEnvelope })
  @ApiResponse({
    status: 403,
    description: 'sales.create permission or branch access required',
    schema: errorEnvelope,
  })
  @ApiResponse({ status: 404, description: 'Barcode not found in tenant', schema: errorEnvelope })
  @ApiResponse({
    status: 422,
    description: 'Invalid barcode or branchId',
    schema: errorEnvelope,
  })
  async scanBarcode(
    @Req() request: AuthenticatedRequest,
    @Param('barcode') barcode: string,
    @Query('branchId') branchId: string,
  ) {
    const principal = this.principal(request);
    const value = barcodeParam.parse(barcode);
    const branchValue = uuid.parse(branchId);
    await this.requireBranch(principal, request, branchValue);

    const barcodeView = await this.catalog.resolveBarcode(principal.organizationId, value);
    if (!barcodeView || !barcodeView.isActive) {
      throw PlatformError.notFound('Barcode was not found.', { details: { barcode: value } });
    }

    let sellable;
    let variant;
    try {
      sellable = await this.catalog.validateSellableVariant(
        principal.organizationId,
        barcodeView.variantId,
      );
      variant = sellable.variant;
    } catch {
      throw PlatformError.notFound('Barcode variant was not found.', {
        details: { variantId: barcodeView.variantId },
      });
    }

    const product = await this.catalog.getProduct(principal.organizationId, variant.productId);

    // The variant is sellable only when both the variant and its product are
    // ACTIVE. A scan may return the variant for display while still flagging
    // whether it can actually be added to a Cart.
    const isSellable =
      variant.organizationId === principal.organizationId &&
      variant.status === 'ACTIVE' &&
      sellable.productStatus === 'ACTIVE';

    return {
      data: {
        barcode: value,
        variantId: variant.id,
        productId: variant.productId,
        productName: product?.name ?? variant.name,
        variantName: variant.name,
        sku: variant.sku,
        baseUnitId: variant.baseUnitId,
        sellable: isSellable,
      },
    };
  }

  private principal(request: AuthenticatedRequest): OrganizationUserPrincipal {
    const principal = request.principal;
    assertTrustedOrganizationUserPrincipal(principal);
    return principal;
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
}
