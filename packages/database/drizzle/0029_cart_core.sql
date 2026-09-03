-- ============================================================================
-- M5-004: Persisted POS Cart Core
-- ============================================================================
-- Cart owns the editable Draft aggregate and its line items. This migration
-- deliberately does not create Inventory reservations, Sales, or Payment rows.
-- Customer is an organization-scoped reference validated through the Customers
-- module contract; Cart does not mutate or foreign-key Customer persistence.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS cart;

CREATE TABLE IF NOT EXISTS cart.carts (
    id                uuid PRIMARY KEY,
    organization_id   uuid NOT NULL REFERENCES organization.organizations(id) ON DELETE CASCADE,
    branch_id         uuid NOT NULL,
    channel           text NOT NULL DEFAULT 'POS',
    status            text NOT NULL DEFAULT 'DRAFT',
    customer_id       uuid,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    version           integer NOT NULL DEFAULT 1,

    CONSTRAINT carts_channel_check CHECK (channel IN ('ONLINE', 'POS', 'SALES')),
    CONSTRAINT carts_status_check CHECK (status = 'DRAFT'),
    CONSTRAINT carts_branch_tenant_fk
        FOREIGN KEY (branch_id, organization_id)
        REFERENCES organization.branches(id, organization_id)
        ON DELETE CASCADE,
    CONSTRAINT carts_tenant_scope_unique UNIQUE (id, organization_id)
);

CREATE INDEX IF NOT EXISTS carts_organization_id_idx
    ON cart.carts (organization_id);

CREATE INDEX IF NOT EXISTS carts_org_branch_created_at_idx
    ON cart.carts (organization_id, branch_id, created_at);

CREATE INDEX IF NOT EXISTS carts_org_status_idx
    ON cart.carts (organization_id, status);

CREATE TABLE IF NOT EXISTS cart.cart_items (
    id                uuid PRIMARY KEY,
    organization_id   uuid NOT NULL REFERENCES organization.organizations(id) ON DELETE CASCADE,
    cart_id           uuid NOT NULL,
    variant_id        uuid NOT NULL,
    unit_id            uuid NOT NULL,
    quantity          numeric(14, 8) NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT cart_items_quantity_positive_check CHECK (quantity > 0),
    -- NUMERIC NaN sorts above finite values, so the upper bound rejects it.
    CONSTRAINT cart_items_quantity_finite_max_check CHECK (quantity <= 999999.99999999),
    CONSTRAINT cart_items_org_cart_variant_unit_unique
        UNIQUE (organization_id, cart_id, variant_id, unit_id),
    CONSTRAINT cart_items_cart_tenant_fk
        FOREIGN KEY (cart_id, organization_id)
        REFERENCES cart.carts(id, organization_id)
        ON DELETE CASCADE,
    CONSTRAINT cart_items_variant_tenant_fk
        FOREIGN KEY (variant_id, organization_id)
        REFERENCES catalog.product_variants(id, organization_id),
    CONSTRAINT cart_items_unit_tenant_fk
        FOREIGN KEY (unit_id, organization_id)
        REFERENCES catalog.unit_definitions(id, organization_id)
);

CREATE INDEX IF NOT EXISTS cart_items_organization_id_idx
    ON cart.cart_items (organization_id);

CREATE INDEX IF NOT EXISTS cart_items_cart_id_idx
    ON cart.cart_items (cart_id);

CREATE INDEX IF NOT EXISTS cart_items_variant_id_idx
    ON cart.cart_items (variant_id);

CREATE INDEX IF NOT EXISTS cart_items_unit_id_idx
    ON cart.cart_items (unit_id, organization_id);
