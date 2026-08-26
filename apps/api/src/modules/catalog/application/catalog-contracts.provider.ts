import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import {
  barcodes,
  products,
  productVariants,
  unitConversions,
  type DatabaseClient,
} from '@commerce-platform/database';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { DATABASE } from '../../database/database.tokens';
import {
  type BarcodeView,
  type CatalogContracts,
  type ProductView,
  type SellableVariantView,
  type VariantView,
} from '../contracts';
import { convert, type UnitConversion } from '../domain/unit-conversion';

/**
 * Read-model implementation of the Catalog module contract.
 *
 * Deliberately queries projections directly (SELECT-only) instead of loading
 * aggregates: contract reads must stay cheap for hot paths such as POS
 * barcode scanning and checkout pricing. All access is organizationId-scoped.
 */
@Injectable()
export class CatalogContractProvider implements CatalogContracts {
  constructor(@Inject(DATABASE) private readonly db: DatabaseClient) {}

  async getProduct(organizationId: string, productId: string): Promise<ProductView | null> {
    const [row] = await this.db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.organizationId, organizationId)))
      .limit(1);

    return row ? toProductView(row) : null;
  }

  async getVariant(organizationId: string, variantId: string): Promise<VariantView | null> {
    const [row] = await this.db
      .select()
      .from(productVariants)
      .where(
        and(eq(productVariants.id, variantId), eq(productVariants.organizationId, organizationId)),
      )
      .limit(1);

    return row ? toVariantView(row) : null;
  }

  async resolveBarcode(organizationId: string, barcodeValue: string): Promise<BarcodeView | null> {
    const [row] = await this.db
      .select()
      .from(barcodes)
      .where(and(eq(barcodes.barcode, barcodeValue), eq(barcodes.organizationId, organizationId)))
      .limit(1);

    return row ? toBarcodeView(row) : null;
  }

  async convertUnit(
    organizationId: string,
    fromUnitId: string,
    toUnitId: string,
    quantity: string,
  ): Promise<string> {
    const rows = await this.db
      .select()
      .from(unitConversions)
      .where(eq(unitConversions.organizationId, organizationId));

    const conversions: UnitConversion[] = rows.map((row) => ({
      fromUnitId: row.fromUnitId,
      toUnitId: row.toUnitId,
      factor: row.factor,
    }));

    return convert(fromUnitId, toUnitId, quantity, conversions);
  }

  async validateSellableVariant(
    organizationId: string,
    variantId: string,
  ): Promise<SellableVariantView> {
    const [variantRow] = await this.db
      .select()
      .from(productVariants)
      .where(
        and(eq(productVariants.id, variantId), eq(productVariants.organizationId, organizationId)),
      )
      .limit(1);

    if (!variantRow) {
      throw PlatformError.of(
        ERROR_CODES.RESOURCE_NOT_FOUND,
        `Variant ${variantId} was not found in organization ${organizationId}.`,
        { details: { variantId, organizationId } },
      );
    }

    const [productRow] = await this.db
      .select({ status: products.status })
      .from(products)
      .where(eq(products.id, variantRow.productId))
      .limit(1);

    if (!productRow) {
      throw PlatformError.of(
        ERROR_CODES.RESOURCE_NOT_FOUND,
        `Product ${variantRow.productId} referenced by variant ${variantId} was not found.`,
        { details: { productId: variantRow.productId, variantId } },
      );
    }

    return {
      variant: toVariantView(variantRow),
      productStatus: productRow.status as ProductView['status'],
    };
  }
}

// ---------------------------------------------------------------------------
// Row-to-view mappers
// ---------------------------------------------------------------------------

interface ProductRow {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
}

function toProductView(row: ProductRow): ProductView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description ?? '',
    status: row.status as ProductView['status'],
    version: row.version,
  };
}

interface VariantRow {
  id: string;
  organizationId: string;
  productId: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  baseUnitId: string;
  categoryId: string | null;
  status: string;
  version: number;
}

function toVariantView(row: VariantRow): VariantView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    productId: row.productId,
    name: row.name,
    sku: row.sku ?? '',
    barcode: row.barcode,
    baseUnitId: row.baseUnitId,
    categoryId: row.categoryId,
    status: row.status as VariantView['status'],
    version: row.version,
  };
}

interface BarcodeRow {
  id: string;
  organizationId: string;
  variantId: string;
  barcode: string;
  packagingDefinitionId: string | null;
  isActive: boolean;
}

function toBarcodeView(row: BarcodeRow): BarcodeView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    variantId: row.variantId,
    barcode: row.barcode,
    packagingDefinitionId: row.packagingDefinitionId,
    isActive: row.isActive,
  };
}
