-- ==========================================================================
-- M5-007: Sales checkout to immutable PENDING_PAYMENT
-- ==========================================================================

CREATE SCHEMA IF NOT EXISTS sales;

ALTER TABLE cart.carts DROP CONSTRAINT IF EXISTS carts_status_check;

ALTER TABLE cart.carts
    ADD CONSTRAINT carts_status_check CHECK (status IN ('DRAFT', 'CHECKED_OUT'));

CREATE TABLE IF NOT EXISTS sales.sales (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organization.organizations(id) ON DELETE CASCADE,
    branch_id uuid NOT NULL,
    warehouse_id uuid,
    cart_id uuid NOT NULL,
    cart_version integer NOT NULL DEFAULT 1,
    customer_id uuid,
    customer_type text,
    customer_display_name text,
    customer_code text,
    operator_id uuid NOT NULL,
    device_id uuid,
    sale_number text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING_PAYMENT',
    price_type text NOT NULL DEFAULT 'CASH',
    currency text NOT NULL,
    subtotal numeric(18, 8) NOT NULL,
    discount_total numeric(18, 8) NOT NULL,
    tax_total numeric(18, 8) NOT NULL,
    total numeric(18, 8) NOT NULL,
    inventory_reservation_id uuid,
    inventory_allocation_id uuid,
    completion_reference_type text,
    completion_reference_id text,
    completed_at timestamptz,
    cancelled_at timestamptz,
    cancellation_reason text,
    cancelled_by uuid,
    correlation_id text NOT NULL,
    causation_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    version integer NOT NULL DEFAULT 1,

    CONSTRAINT sales_status_check CHECK (status IN ('PENDING_PAYMENT', 'COMPLETED', 'CANCELLED')),
    CONSTRAINT sales_price_type_check CHECK (price_type IN ('CASH', 'WHOLESALE', 'CREDIT', 'ONLINE')),
    CONSTRAINT sales_cart_version_check CHECK (cart_version >= 1),
    CONSTRAINT sales_subtotal_non_negative_check CHECK (subtotal >= 0),
    CONSTRAINT sales_discount_total_non_negative_check CHECK (discount_total >= 0),
    CONSTRAINT sales_tax_total_non_negative_check CHECK (tax_total >= 0),
    CONSTRAINT sales_total_non_negative_check CHECK (total >= 0),
    CONSTRAINT sales_customer_type_check CHECK (customer_type IS NULL OR customer_type IN ('INDIVIDUAL', 'BUSINESS')),
    CONSTRAINT sales_tenant_scope_unique UNIQUE (id, organization_id),
    CONSTRAINT sales_branch_tenant_fk
        FOREIGN KEY (branch_id, organization_id)
        REFERENCES organization.branches(id, organization_id)
        ON DELETE CASCADE,
    CONSTRAINT sales_warehouse_tenant_branch_fk
        FOREIGN KEY (warehouse_id, organization_id, branch_id)
        REFERENCES organization.warehouses(id, organization_id, branch_id),
    CONSTRAINT sales_cart_tenant_fk
        FOREIGN KEY (cart_id, organization_id)
        REFERENCES cart.carts(id, organization_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_org_sale_number_unique
    ON sales.sales (organization_id, sale_number);

CREATE UNIQUE INDEX IF NOT EXISTS sales_one_sale_per_cart_unique
    ON sales.sales (organization_id, cart_id);

CREATE UNIQUE INDEX IF NOT EXISTS sales_completion_reference_unique
    ON sales.sales (organization_id, completion_reference_type, completion_reference_id)
    WHERE completion_reference_type IS NOT NULL AND completion_reference_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_org_branch_created_at_idx
    ON sales.sales (organization_id, branch_id, created_at);

CREATE INDEX IF NOT EXISTS sales_org_status_created_at_idx
    ON sales.sales (organization_id, status, created_at);

CREATE INDEX IF NOT EXISTS sales_org_cart_idx
    ON sales.sales (organization_id, cart_id);

CREATE INDEX IF NOT EXISTS sales_org_customer_idx
    ON sales.sales (organization_id, customer_id);

CREATE TABLE IF NOT EXISTS sales.sale_items (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organization.organizations(id) ON DELETE CASCADE,
    sale_id uuid NOT NULL,
    cart_item_id uuid,
    product_id uuid,
    variant_id uuid NOT NULL,
    product_name text,
    variant_name text,
    snapshot_label text NOT NULL,
    sku text,
    barcode text,
    unit_id uuid NOT NULL,
    base_unit_id uuid,
    quantity numeric(18, 8) NOT NULL,
    base_quantity numeric(18, 8) NOT NULL,
    unit_price numeric(18, 8) NOT NULL,
    line_subtotal numeric(18, 8) NOT NULL,
    discount_total numeric(18, 8) NOT NULL,
    tax_total numeric(18, 8) NOT NULL,
    line_total numeric(18, 8) NOT NULL,
    currency text NOT NULL,
    price_type text NOT NULL,
    pricing_source text NOT NULL,
    pricing_reference text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT sale_items_quantity_positive_check CHECK (quantity > 0),
    CONSTRAINT sale_items_base_quantity_positive_check CHECK (base_quantity > 0),
    CONSTRAINT sale_items_unit_price_non_negative_check CHECK (unit_price >= 0),
    CONSTRAINT sale_items_line_subtotal_non_negative_check CHECK (line_subtotal >= 0),
    CONSTRAINT sale_items_discount_total_non_negative_check CHECK (discount_total >= 0),
    CONSTRAINT sale_items_tax_total_non_negative_check CHECK (tax_total >= 0),
    CONSTRAINT sale_items_line_total_non_negative_check CHECK (line_total >= 0),
    CONSTRAINT sale_items_price_type_check CHECK (price_type IN ('CASH', 'WHOLESALE', 'CREDIT', 'ONLINE')),
    CONSTRAINT sale_items_pricing_source_check CHECK (pricing_source IN ('BRANCH', 'ORGANIZATIONAL')),
    CONSTRAINT sale_items_tenant_scope_unique UNIQUE (id, organization_id),
    CONSTRAINT sale_items_sale_tenant_fk
        FOREIGN KEY (sale_id, organization_id)
        REFERENCES sales.sales(id, organization_id)
        ON DELETE CASCADE,
    CONSTRAINT sale_items_product_tenant_fk
        FOREIGN KEY (product_id, organization_id)
        REFERENCES catalog.products(id, organization_id),
    CONSTRAINT sale_items_variant_tenant_fk
        FOREIGN KEY (variant_id, organization_id)
        REFERENCES catalog.product_variants(id, organization_id),
    CONSTRAINT sale_items_unit_tenant_fk
        FOREIGN KEY (unit_id, organization_id)
        REFERENCES catalog.unit_definitions(id, organization_id),
    CONSTRAINT sale_items_base_unit_tenant_fk
        FOREIGN KEY (base_unit_id, organization_id)
        REFERENCES catalog.unit_definitions(id, organization_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS sale_items_sale_cart_item_unique
    ON sales.sale_items (organization_id, sale_id, cart_item_id)
    WHERE cart_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sale_items_org_sale_idx
    ON sales.sale_items (organization_id, sale_id);

CREATE INDEX IF NOT EXISTS sale_items_org_variant_idx
    ON sales.sale_items (organization_id, variant_id);

CREATE TABLE IF NOT EXISTS sales.sale_number_counters (
    organization_id uuid PRIMARY KEY REFERENCES organization.organizations(id) ON DELETE CASCADE,
    next_value bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sale_number_counters_next_value_check CHECK (next_value >= 1)
);
