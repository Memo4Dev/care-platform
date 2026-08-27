-- ============================================================================
-- M4-001: Purchasing Core Persistence
-- ============================================================================
-- Creates logical schema `purchasing` with all core tables:
--   suppliers, purchase_orders, purchase_order_items,
--   goods_receipts, goods_receipt_items, purchase_costs.
--
-- Conventions:
--   - Every tenant-owned row carries organization_id (tenant boundary).
--   - Composite tenant FKs: (parent_id, organization_id) -> parent(id, organization_id).
--   - Quantities/costs are decimal(14,4), never float.
--   - Multiple POs for same Supplier + Variant are allowed.
--   - GoodsReceipt is separate from PurchaseOrder.
--   - Confirmed GoodsReceipt is immutable (enforced at application layer).
--   - All DDL is idempotent (IF NOT EXISTS).
-- ============================================================================

-- Create logical schema if it does not exist
CREATE SCHEMA IF NOT EXISTS purchasing;

-- ============================================================================
-- suppliers — External Vendor Identity
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchasing.suppliers (
    id                uuid PRIMARY KEY,
    organization_id   uuid NOT NULL REFERENCES organization.organizations(id) ON DELETE CASCADE,
    name              text NOT NULL,
    code              text NOT NULL,
    contact_name      text,
    email             text,
    phone             text,
    address           text,
    is_active         boolean NOT NULL DEFAULT true,
    notes             text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    version           integer NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_code_unique
    ON purchasing.suppliers (organization_id, code);

-- Tenant-scope unique for FK references from child tables (purchase_orders)
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_tenant_scope_unique
    ON purchasing.suppliers (id, organization_id);

CREATE INDEX IF NOT EXISTS suppliers_organization_id_idx
    ON purchasing.suppliers (organization_id);

-- ============================================================================
-- purchase_orders — Aggregate Identity
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchasing.purchase_orders (
    id                       uuid PRIMARY KEY,
    organization_id          uuid NOT NULL REFERENCES organization.organizations(id) ON DELETE CASCADE,
    supplier_id              uuid NOT NULL,
    status                   text NOT NULL DEFAULT 'DRAFT',
    warehouse_id             uuid NOT NULL,
    order_date               timestamptz NOT NULL DEFAULT now(),
    expected_delivery_date   timestamptz,
    notes                    text,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    version                  integer NOT NULL DEFAULT 1,

    CONSTRAINT purchase_orders_supplier_tenant_fk
        FOREIGN KEY (supplier_id, organization_id)
        REFERENCES purchasing.suppliers(id, organization_id)
        ON DELETE CASCADE,

    CONSTRAINT purchase_orders_warehouse_tenant_fk
        FOREIGN KEY (warehouse_id, organization_id)
        REFERENCES organization.warehouses(id, organization_id)
        ON DELETE CASCADE
);

-- Tenant-scope unique for FK references from child tables (purchase_order_items, goods_receipts)
CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_tenant_scope_unique
    ON purchasing.purchase_orders (id, organization_id);

CREATE INDEX IF NOT EXISTS purchase_orders_organization_id_idx
    ON purchasing.purchase_orders (organization_id);

CREATE INDEX IF NOT EXISTS purchase_orders_supplier_id_idx
    ON purchasing.purchase_orders (supplier_id);

CREATE INDEX IF NOT EXISTS purchase_orders_warehouse_id_idx
    ON purchasing.purchase_orders (warehouse_id);

CREATE INDEX IF NOT EXISTS purchase_orders_status_idx
    ON purchasing.purchase_orders (status);

CREATE INDEX IF NOT EXISTS purchase_orders_org_status_idx
    ON purchasing.purchase_orders (organization_id, status);

-- ============================================================================
-- purchase_order_items — Line Items
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchasing.purchase_order_items (
    id                      uuid PRIMARY KEY,
    organization_id         uuid NOT NULL REFERENCES organization.organizations(id) ON DELETE CASCADE,
    purchase_order_id       uuid NOT NULL,
    variant_id              uuid NOT NULL,
    quantity                decimal(14,4) NOT NULL,
    received_quantity       decimal(14,4) NOT NULL DEFAULT '0',
    unit_cost               decimal(14,4) NOT NULL,
    packaging_unit          text,
    packaging_quantity      decimal(14,4),
    packaging_conversion    decimal(14,4),
    notes                   text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT purchase_order_items_purchase_order_tenant_fk
        FOREIGN KEY (purchase_order_id, organization_id)
        REFERENCES purchasing.purchase_orders(id, organization_id)
        ON DELETE CASCADE,

    CONSTRAINT purchase_order_items_variant_tenant_fk
        FOREIGN KEY (variant_id, organization_id)
        REFERENCES catalog.product_variants(id, organization_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS purchase_order_items_organization_id_idx
    ON purchasing.purchase_order_items (organization_id);

-- Tenant-scope unique for FK references from child tables (goods_receipt_items)
CREATE UNIQUE INDEX IF NOT EXISTS purchase_order_items_tenant_scope_unique
    ON purchasing.purchase_order_items (id, organization_id);

CREATE INDEX IF NOT EXISTS purchase_order_items_purchase_order_id_idx
    ON purchasing.purchase_order_items (purchase_order_id);

CREATE INDEX IF NOT EXISTS purchase_order_items_variant_id_idx
    ON purchasing.purchase_order_items (variant_id);

-- ============================================================================
-- goods_receipts — Receiving Aggregate
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchasing.goods_receipts (
    id                    uuid PRIMARY KEY,
    organization_id       uuid NOT NULL REFERENCES organization.organizations(id) ON DELETE CASCADE,
    purchase_order_id     uuid NOT NULL,
    warehouse_id          uuid NOT NULL,
    status                text NOT NULL DEFAULT 'PENDING',
    received_date         timestamptz NOT NULL DEFAULT now(),
    notes                 text,
    confirmed_at          timestamptz,
    confirmed_by          uuid,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    version               integer NOT NULL DEFAULT 1,

    CONSTRAINT goods_receipts_purchase_order_tenant_fk
        FOREIGN KEY (purchase_order_id, organization_id)
        REFERENCES purchasing.purchase_orders(id, organization_id)
        ON DELETE CASCADE,

    CONSTRAINT goods_receipts_warehouse_tenant_fk
        FOREIGN KEY (warehouse_id, organization_id)
        REFERENCES organization.warehouses(id, organization_id)
        ON DELETE CASCADE
);

-- Tenant-scope unique for FK references from child tables (goods_receipt_items, purchase_costs)
CREATE UNIQUE INDEX IF NOT EXISTS goods_receipts_tenant_scope_unique
    ON purchasing.goods_receipts (id, organization_id);

CREATE INDEX IF NOT EXISTS goods_receipts_organization_id_idx
    ON purchasing.goods_receipts (organization_id);

CREATE INDEX IF NOT EXISTS goods_receipts_purchase_order_id_idx
    ON purchasing.goods_receipts (purchase_order_id);

CREATE INDEX IF NOT EXISTS goods_receipts_warehouse_id_idx
    ON purchasing.goods_receipts (warehouse_id);

CREATE INDEX IF NOT EXISTS goods_receipts_status_idx
    ON purchasing.goods_receipts (status);

CREATE INDEX IF NOT EXISTS goods_receipts_org_status_idx
    ON purchasing.goods_receipts (organization_id, status);

-- ============================================================================
-- goods_receipt_items — Receiving Line Items
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchasing.goods_receipt_items (
    id                        uuid PRIMARY KEY,
    organization_id           uuid NOT NULL REFERENCES organization.organizations(id) ON DELETE CASCADE,
    goods_receipt_id          uuid NOT NULL,
    purchase_order_item_id    uuid NOT NULL,
    variant_id                uuid NOT NULL,
    quantity_received         decimal(14,4) NOT NULL,
    quantity_accepted         decimal(14,4) NOT NULL,
    quantity_rejected         decimal(14,4) NOT NULL DEFAULT '0',
    unit_cost                 decimal(14,4) NOT NULL,
    notes                     text,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT goods_receipt_items_goods_receipt_tenant_fk
        FOREIGN KEY (goods_receipt_id, organization_id)
        REFERENCES purchasing.goods_receipts(id, organization_id)
        ON DELETE CASCADE,

    CONSTRAINT goods_receipt_items_purchase_order_item_tenant_fk
        FOREIGN KEY (purchase_order_item_id, organization_id)
        REFERENCES purchasing.purchase_order_items(id, organization_id)
        ON DELETE CASCADE,

    CONSTRAINT goods_receipt_items_variant_tenant_fk
        FOREIGN KEY (variant_id, organization_id)
        REFERENCES catalog.product_variants(id, organization_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS goods_receipt_items_organization_id_idx
    ON purchasing.goods_receipt_items (organization_id);

CREATE INDEX IF NOT EXISTS goods_receipt_items_goods_receipt_id_idx
    ON purchasing.goods_receipt_items (goods_receipt_id);

CREATE INDEX IF NOT EXISTS goods_receipt_items_purchase_order_item_id_idx
    ON purchasing.goods_receipt_items (purchase_order_item_id);

CREATE INDEX IF NOT EXISTS goods_receipt_items_variant_id_idx
    ON purchasing.goods_receipt_items (variant_id);

-- ============================================================================
-- purchase_costs — Additional Costs Per Receipt
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchasing.purchase_costs (
    id                  uuid PRIMARY KEY,
    organization_id     uuid NOT NULL REFERENCES organization.organizations(id) ON DELETE CASCADE,
    goods_receipt_id    uuid NOT NULL,
    cost_type           text NOT NULL,
    amount              decimal(14,4) NOT NULL,
    currency            text NOT NULL DEFAULT 'USD',
    description         text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT purchase_costs_goods_receipt_tenant_fk
        FOREIGN KEY (goods_receipt_id, organization_id)
        REFERENCES purchasing.goods_receipts(id, organization_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS purchase_costs_organization_id_idx
    ON purchasing.purchase_costs (organization_id);

CREATE INDEX IF NOT EXISTS purchase_costs_goods_receipt_id_idx
    ON purchasing.purchase_costs (goods_receipt_id);

CREATE INDEX IF NOT EXISTS purchase_costs_cost_type_idx
    ON purchasing.purchase_costs (cost_type);
