import { PlatformError } from '@commerce-platform/contracts';

/**
 * Barcode value object — associates a barcode string with a variant and
 * optional packaging definition.
 *
 * Barcodes are NOT independent aggregates — they are value objects that
 * belong to a variant. Each barcode optionally references a
 * PackagingDefinition to indicate which packaging level it represents
 * (e.g. a barcode for a box vs. a barcode for a strip of the same variant).
 *
 * This file imports only plain contracts: no NestJS, no Drizzle.
 */
export interface BarcodeState {
  readonly id: string;
  readonly organizationId: string;
  readonly variantId: string;
  barcode: string;
  packagingDefinitionId: string | null;
  isActive: boolean;
}

export class Barcode {
  private readonly state: BarcodeState;

  private constructor(state: BarcodeState) {
    this.state = state;
  }

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Domain command: AddBarcode.
   *
   * Creates a new barcode association for a variant. A barcode may optionally
   * reference a packaging definition to indicate the packaging level.
   */
  static create(input: {
    id: string;
    organizationId: string;
    variantId: string;
    barcode: string;
    packagingDefinitionId?: string | null;
  }): Barcode {
    const barcode = assertNonEmpty(input.barcode, 'barcode');

    return new Barcode({
      id: input.id,
      organizationId: input.organizationId,
      variantId: input.variantId,
      barcode,
      packagingDefinitionId: input.packagingDefinitionId ?? null,
      isActive: true,
    });
  }

  /** Rehydrate a persisted barcode from repository data. */
  static reconstitute(state: BarcodeState): Barcode {
    return new Barcode({ ...state });
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  get id(): string {
    return this.state.id;
  }

  get organizationId(): string {
    return this.state.organizationId;
  }

  get variantId(): string {
    return this.state.variantId;
  }

  get barcode(): string {
    return this.state.barcode;
  }

  get packagingDefinitionId(): string | null {
    return this.state.packagingDefinitionId;
  }

  get isActive(): boolean {
    return this.state.isActive;
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /**
   * Domain command: DeactivateBarcode.
   *
   * Deactivating an already-inactive barcode is an accepted no-op that
   * returns false. This mirrors the Warehouse deactivation pattern.
   */
  deactivate(): boolean {
    if (!this.state.isActive) {
      return false;
    }
    this.state.isActive = false;
    return true;
  }
}

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw PlatformError.validationFailed(`${field} must be a non-empty string.`, {
      details: { field },
    });
  }
  return value;
}
