import { PERMISSION_CODES, type PermissionCode } from '@commerce-platform/database';

/**
 * Default tenant role templates (docs/architecture/72-authorization-matrix.md
 * "Tenant Role Templates" + "Capability Matrix"), seeded per organization by
 * M1-008 provisioning. NOT auto-applied to existing organizations.
 *
 * Matrix reading (task decision, verbatim):
 * - ✅  -> granted by this template,
 * - "configurable" -> NOT granted by default; the Owner grants it later via
 *   users.manage (system templates stay editable — see Role aggregate),
 * - ❌ / no cell -> not granted.
 *
 * The matrix has no Delivery column: the Delivery template ships EMPTY and is
 * filled in once delivery capabilities are defined. `sales.edit` (from
 * docs/architecture/11-identity-access.md) is outside the matrix entirely:
 * only the Owner template receives it, because Owner carries ALL capabilities.
 */
export interface RoleTemplate {
  /** Per-organization business code of the role row. */
  readonly code: string;
  readonly name: string;
  readonly permissionCodes: readonly PermissionCode[];
}

export const DEFAULT_ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    code: 'OWNER',
    name: 'Owner',
    // ALL capabilities incl. users.manage and sales.edit.
    permissionCodes: [...PERMISSION_CODES],
  },
  {
    code: 'MANAGER',
    name: 'Manager',
    permissionCodes: [
      'sales.read',
      'sales.create',
      'sales.cancel',
      'order.approve',
      'refund.create',
      'inventory.view',
      'credit.use',
      'offline.resolve',
      'catalog.view',
      'catalog.create',
      'catalog.edit',
      'pricing.view',
    ],
  },
  {
    code: 'SALES',
    name: 'Sales',
    permissionCodes: ['sales.read', 'sales.create', 'catalog.view', 'pricing.view'],
  },
  {
    code: 'CASHIER',
    name: 'Cashier',
    permissionCodes: ['sales.read', 'sales.create', 'catalog.view', 'pricing.view'],
  },
  {
    code: 'WAREHOUSE',
    name: 'Warehouse',
    permissionCodes: ['inventory.view', 'inventory.transfer', 'catalog.view'],
  },
  {
    code: 'PURCHASING',
    name: 'Purchasing',
    permissionCodes: ['inventory.view', 'purchase.create', 'catalog.view', 'pricing.view'],
  },
  {
    code: 'DELIVERY',
    name: 'Delivery',
    // No capability column exists for Delivery in the matrix yet.
    permissionCodes: [],
  },
];
