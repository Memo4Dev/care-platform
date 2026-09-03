import { check, index, pgSchema, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { organizations } from './organization';
import { idColumn, optimisticVersion, timestamps } from './shared';

/** Narrow M5 BusinessCustomer baseline; CRM/account capabilities stay elsewhere. */
export const customersSchema = pgSchema('customers');

export const CUSTOMER_TYPES = ['INDIVIDUAL', 'BUSINESS'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const businessCustomers = customersSchema.table(
  'business_customers',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    type: text('type').$type<CustomerType>().notNull(),
    displayName: text('display_name').notNull(),
    code: text('code'),
    phone: text('phone'),
    email: text('email'),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    check('business_customers_type_check', sql`${table.type} IN ('INDIVIDUAL', 'BUSINESS')`),
    uniqueIndex('business_customers_org_code_unique')
      .on(table.organizationId, table.code)
      .where(sql`${table.code} IS NOT NULL`),
    uniqueIndex('business_customers_tenant_scope_unique').on(table.id, table.organizationId),
    index('business_customers_organization_id_idx').on(table.organizationId),
    index('business_customers_org_display_name_idx').on(table.organizationId, table.displayName),
  ],
);
