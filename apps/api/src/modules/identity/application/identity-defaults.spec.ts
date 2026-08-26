import { PERMISSION_CODES, type PermissionCode } from '@commerce-platform/database';
import { describe, expect, it } from 'vitest';

import { DEFAULT_ROLE_TEMPLATES } from './identity-defaults';

/**
 * Verbatim transcription of docs/architecture/72-authorization-matrix.md
 * "Capability Matrix". Y = ✅ granted, C = "configurable" (template ships
 * WITHOUT the permission; grantable later), N = ❌. `sales.edit` is not part
 * of the matrix (it comes from docs/architecture/11-identity-access.md); it is
 * granted to Owner only because Owner carries ALL capabilities.
 */
const MATRIX: ReadonlyArray<{
  code: PermissionCode;
  owner: 'Y' | 'C' | 'N';
  manager: 'Y' | 'C' | 'N';
  sales: 'Y' | 'C' | 'N';
  cashier: 'Y' | 'C' | 'N';
  warehouse: 'Y' | 'C' | 'N';
  purchasing: 'Y' | 'C' | 'N';
}> = [
  {
    code: 'sales.create',
    owner: 'Y',
    manager: 'Y',
    sales: 'Y',
    cashier: 'Y',
    warehouse: 'N',
    purchasing: 'N',
  },
  // Not a matrix row; Owner-only via the all-capabilities rule.
  {
    code: 'sales.edit',
    owner: 'Y',
    manager: 'N',
    sales: 'N',
    cashier: 'N',
    warehouse: 'N',
    purchasing: 'N',
  },
  {
    code: 'sales.cancel',
    owner: 'Y',
    manager: 'Y',
    sales: 'C',
    cashier: 'C',
    warehouse: 'N',
    purchasing: 'N',
  },
  {
    code: 'price.override',
    owner: 'Y',
    manager: 'C',
    sales: 'C',
    cashier: 'N',
    warehouse: 'N',
    purchasing: 'N',
  },
  {
    code: 'discount.override',
    owner: 'Y',
    manager: 'C',
    sales: 'C',
    cashier: 'N',
    warehouse: 'N',
    purchasing: 'N',
  },
  {
    code: 'order.approve',
    owner: 'Y',
    manager: 'Y',
    sales: 'C',
    cashier: 'N',
    warehouse: 'N',
    purchasing: 'N',
  },
  {
    code: 'refund.create',
    owner: 'Y',
    manager: 'Y',
    sales: 'C',
    cashier: 'C',
    warehouse: 'N',
    purchasing: 'N',
  },
  {
    code: 'refund.override',
    owner: 'Y',
    manager: 'C',
    sales: 'N',
    cashier: 'N',
    warehouse: 'N',
    purchasing: 'N',
  },
  {
    code: 'inventory.view',
    owner: 'Y',
    manager: 'Y',
    sales: 'C',
    cashier: 'C',
    warehouse: 'Y',
    purchasing: 'Y',
  },
  {
    code: 'inventory.adjust',
    owner: 'Y',
    manager: 'C',
    sales: 'N',
    cashier: 'N',
    warehouse: 'C',
    purchasing: 'N',
  },
  {
    code: 'inventory.transfer',
    owner: 'Y',
    manager: 'C',
    sales: 'N',
    cashier: 'N',
    warehouse: 'Y',
    purchasing: 'N',
  },
  {
    code: 'purchase.create',
    owner: 'Y',
    manager: 'C',
    sales: 'N',
    cashier: 'N',
    warehouse: 'N',
    purchasing: 'Y',
  },
  {
    code: 'purchase.approve',
    owner: 'Y',
    manager: 'C',
    sales: 'N',
    cashier: 'N',
    warehouse: 'N',
    purchasing: 'C',
  },
  {
    code: 'credit.use',
    owner: 'Y',
    manager: 'Y',
    sales: 'C',
    cashier: 'C',
    warehouse: 'N',
    purchasing: 'N',
  },
  {
    code: 'credit.override',
    owner: 'Y',
    manager: 'C',
    sales: 'N',
    cashier: 'N',
    warehouse: 'N',
    purchasing: 'N',
  },
  {
    code: 'offline.resolve',
    owner: 'Y',
    manager: 'Y',
    sales: 'N',
    cashier: 'N',
    warehouse: 'N',
    purchasing: 'N',
  },
  {
    code: 'cash.reconcile',
    owner: 'Y',
    manager: 'C',
    sales: 'N',
    cashier: 'C',
    warehouse: 'N',
    purchasing: 'N',
  },
  // No Delivery column exists in the matrix.
  {
    code: 'delivery.manage',
    owner: 'Y',
    manager: 'C',
    sales: 'N',
    cashier: 'N',
    warehouse: 'N',
    purchasing: 'N',
  },
  {
    code: 'users.manage',
    owner: 'Y',
    manager: 'C',
    sales: 'N',
    cashier: 'N',
    warehouse: 'N',
    purchasing: 'N',
  },
  {
    code: 'catalog.view',
    owner: 'Y',
    manager: 'Y',
    sales: 'Y',
    cashier: 'Y',
    warehouse: 'Y',
    purchasing: 'Y',
  },
  {
    code: 'catalog.create',
    owner: 'Y',
    manager: 'Y',
    sales: 'N',
    cashier: 'N',
    warehouse: 'N',
    purchasing: 'N',
  },
  {
    code: 'catalog.edit',
    owner: 'Y',
    manager: 'Y',
    sales: 'N',
    cashier: 'N',
    warehouse: 'N',
    purchasing: 'N',
  },
  {
    code: 'catalog.delete',
    owner: 'Y',
    manager: 'C',
    sales: 'N',
    cashier: 'N',
    warehouse: 'N',
    purchasing: 'N',
  },
  {
    code: 'pricing.view',
    owner: 'Y',
    manager: 'Y',
    sales: 'Y',
    cashier: 'Y',
    warehouse: 'N',
    purchasing: 'Y',
  },
  {
    code: 'pricing.create',
    owner: 'Y',
    manager: 'C',
    sales: 'N',
    cashier: 'N',
    warehouse: 'N',
    purchasing: 'N',
  },
  {
    code: 'pricing.edit',
    owner: 'Y',
    manager: 'C',
    sales: 'N',
    cashier: 'N',
    warehouse: 'N',
    purchasing: 'N',
  },
  {
    code: 'pricing.delete',
    owner: 'Y',
    manager: 'C',
    sales: 'N',
    cashier: 'N',
    warehouse: 'N',
    purchasing: 'N',
  },
];

const GRANTED_BY_TEMPLATE: Record<string, readonly PermissionCode[]> = {
  OWNER: PERMISSION_CODES,
  MANAGER: MATRIX.filter((row) => row.manager === 'Y').map((row) => row.code),
  SALES: MATRIX.filter((row) => row.sales === 'Y').map((row) => row.code),
  CASHIER: MATRIX.filter((row) => row.cashier === 'Y').map((row) => row.code),
  WAREHOUSE: MATRIX.filter((row) => row.warehouse === 'Y').map((row) => row.code),
  PURCHASING: MATRIX.filter((row) => row.purchasing === 'Y').map((row) => row.code),
  // No capability column for Delivery in the matrix -> template ships empty.
  DELIVERY: [],
};

describe('default role templates (docs/architecture/72 authorization matrix)', () => {
  it('given the seeded templates when inspected then exactly Owner/Manager/Sales/Cashier/Warehouse/Purchasing/Delivery exist as system roles', () => {
    expect(DEFAULT_ROLE_TEMPLATES.map((template) => template.code)).toEqual([
      'OWNER',
      'MANAGER',
      'SALES',
      'CASHIER',
      'WAREHOUSE',
      'PURCHASING',
      'DELIVERY',
    ]);
    expect(DEFAULT_ROLE_TEMPLATES.every((template) => template.name.length > 0)).toBe(true);
  });

  it.each(Object.entries(GRANTED_BY_TEMPLATE))(
    'given template %s when compared cell-by-cell with the matrix then its granted set matches EXACTLY',
    (code, expectedGranted) => {
      const template = DEFAULT_ROLE_TEMPLATES.find((entry) => entry.code === code);
      expect(template, `template ${code} must exist`).toBeDefined();

      // Exact set equality (order-insensitive): no missing grant, no extra grant.
      expect([...(template?.permissionCodes ?? [])].sort()).toEqual([...expectedGranted].sort());
    },
  );

  it('given the OWNER template when inspected then it carries ALL catalog capabilities incl. users.manage and sales.edit', () => {
    const owner = DEFAULT_ROLE_TEMPLATES.find((template) => template.code === 'OWNER');
    expect(owner).toBeDefined();
    expect([...owner!.permissionCodes].sort()).toEqual([...PERMISSION_CODES].sort());
    expect(owner!.permissionCodes).toContain('users.manage');
    expect(owner!.permissionCodes).toContain('sales.edit');
  });

  it('given every template when inspected then every granted code belongs to the global permission catalog', () => {
    for (const template of DEFAULT_ROLE_TEMPLATES) {
      for (const code of template.permissionCodes) {
        expect(PERMISSION_CODES, `${template.code} grants unknown code ${code}`).toContain(code);
      }
    }
  });

  it('given configurable cells when derived then no template grants them by default (configurable means NOT shipped)', () => {
    const configurableCodes = MATRIX.flatMap((row) => {
      const cells = [row.manager, row.sales, row.cashier, row.warehouse, row.purchasing];
      return cells.includes('C') ? [row.code] : [];
    });

    for (const template of DEFAULT_ROLE_TEMPLATES) {
      // OWNER carries ALL capabilities by definition; DELIVERY has no matrix
      // column at all (already pinned to an empty grant set above).
      if (template.code === 'OWNER' || template.code === 'DELIVERY') {
        continue;
      }
      const column = columnFor(template.code);
      for (const code of configurableCodes) {
        if (MATRIX.find((row) => row.code === code)?.[column] === 'C') {
          expect(
            template.permissionCodes,
            `${template.code} must not ship configurable cell ${code}`,
          ).not.toContain(code);
        }
      }
    }
  });
});

/** Map template codes onto their matrix column keys. */
function columnFor(code: string): 'manager' | 'sales' | 'cashier' | 'warehouse' | 'purchasing' {
  switch (code) {
    case 'MANAGER':
      return 'manager';
    case 'SALES':
      return 'sales';
    case 'CASHIER':
      return 'cashier';
    case 'WAREHOUSE':
      return 'warehouse';
    case 'PURCHASING':
      return 'purchasing';
    default:
      throw new Error(`Template ${code} has no matrix column`);
  }
}
