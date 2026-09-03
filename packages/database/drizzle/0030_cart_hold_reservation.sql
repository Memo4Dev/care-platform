-- ============================================================================
-- M5-005 persistence foundation: Cart hold workflow + grouped reservations
-- ============================================================================
-- Expand-first only:
--   * Organization gains the CART policy enum value.
--   * Cart gains durable hold/workflow rows while carts remain DRAFT.
--   * Inventory reservations gain one-root/many-position persistence while old
--     single-position writes remain compatible through derivation triggers.
--   * Correctness quantities gain eight exact decimal places without reducing
--     the existing ten-digit integer capacity.
--
-- PostgreSQL numeric(p,s) rounds excess fractional digits before CHECK
-- constraints run. `inventory.quantity_18_8` therefore uses unconstrained
-- numeric plus domain checks equivalent to NUMERIC(18,8), so a ninth decimal is
-- rejected rather than silently rounded. Inventory unit_cost is unchanged.
-- ============================================================================

ALTER TYPE organization.organization_policy_type ADD VALUE IF NOT EXISTS 'CART';

-- Composite scope anchors needed by Cart and Inventory same-branch warehouse
-- foreign keys. Existing (id, organization_id) anchors remain unchanged.
CREATE UNIQUE INDEX IF NOT EXISTS warehouses_tenant_branch_scope_unique
    ON organization.warehouses (id, organization_id, branch_id);

CREATE UNIQUE INDEX IF NOT EXISTS carts_tenant_branch_scope_unique
    ON cart.carts (id, organization_id, branch_id);

-- ============================================================================
-- Cart-owned durable hold workflow
-- ============================================================================

CREATE TABLE IF NOT EXISTS cart.cart_holds (
    id                       uuid PRIMARY KEY,
    organization_id          uuid NOT NULL REFERENCES organization.organizations(id) ON DELETE CASCADE,
    cart_id                  uuid NOT NULL,
    branch_id                uuid NOT NULL,
    warehouse_id             uuid NOT NULL,
    cart_version             integer NOT NULL,
    status                   text NOT NULL DEFAULT 'PENDING',
    ttl_minutes              integer NOT NULL,
    policy_version           integer NOT NULL,
    inventory_reservation_id uuid,
    expires_at               timestamptz,
    shortages_json           jsonb,
    failure_json             jsonb,
    actor_id                 uuid NOT NULL,
    correlation_id           text NOT NULL,
    causation_id             text NOT NULL,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    version                  integer NOT NULL DEFAULT 1,

    CONSTRAINT cart_holds_cart_version_positive_check CHECK (cart_version >= 1),
    CONSTRAINT cart_holds_status_check
        CHECK (status IN ('PENDING', 'ACTIVE', 'RELEASING', 'RELEASED', 'EXPIRED', 'FAILED')),
    CONSTRAINT cart_holds_ttl_minutes_check CHECK (ttl_minutes BETWEEN 1 AND 1440),
    CONSTRAINT cart_holds_policy_version_check CHECK (policy_version >= 0),
    CONSTRAINT cart_holds_cart_tenant_branch_fk
        FOREIGN KEY (cart_id, organization_id, branch_id)
        REFERENCES cart.carts(id, organization_id, branch_id)
        ON DELETE CASCADE,
    CONSTRAINT cart_holds_warehouse_tenant_branch_fk
        FOREIGN KEY (warehouse_id, organization_id, branch_id)
        REFERENCES organization.warehouses(id, organization_id, branch_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS cart_holds_one_current_per_cart_unique
    ON cart.cart_holds (organization_id, cart_id)
    WHERE status IN ('PENDING', 'ACTIVE', 'RELEASING');

CREATE INDEX IF NOT EXISTS cart_holds_org_cart_created_at_idx
    ON cart.cart_holds (organization_id, cart_id, created_at);

CREATE INDEX IF NOT EXISTS cart_holds_current_workflow_idx
    ON cart.cart_holds (organization_id, status, updated_at)
    WHERE status IN ('PENDING', 'ACTIVE', 'RELEASING');

CREATE INDEX IF NOT EXISTS cart_holds_warehouse_scope_idx
    ON cart.cart_holds (warehouse_id, organization_id, branch_id);

-- A partial unique key cannot be the target of a foreign key, so warehouse
-- activity is checked under a row lock at workflow creation. Historical holds
-- remain valid references if the warehouse is deactivated later.
CREATE OR REPLACE FUNCTION cart.enforce_cart_hold_active_warehouse()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM 1
      FROM organization.warehouses AS warehouse
     WHERE warehouse.id = NEW.warehouse_id
       AND warehouse.organization_id = NEW.organization_id
       AND warehouse.branch_id = NEW.branch_id
       AND warehouse.is_active = true
     FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cart hold warehouse must be active and belong to the Cart tenant branch.'
            USING ERRCODE = '23503',
                  CONSTRAINT = 'cart_holds_active_warehouse_check';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cart_holds_active_warehouse_trigger ON cart.cart_holds;
CREATE TRIGGER cart_holds_active_warehouse_trigger
    BEFORE INSERT OR UPDATE OF organization_id, branch_id, warehouse_id
    ON cart.cart_holds
    FOR EACH ROW
    EXECUTE FUNCTION cart.enforce_cart_hold_active_warehouse();

-- ============================================================================
-- Exact Inventory quantity domain (semantic NUMERIC(18,8), no input rounding)
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_type AS type
          JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
         WHERE namespace.nspname = 'inventory'
           AND type.typname = 'quantity_18_8'
    ) THEN
        CREATE DOMAIN inventory.quantity_18_8 AS numeric
            CONSTRAINT quantity_18_8_exact_check CHECK (
                VALUE::text <> 'NaN'
                AND VALUE > -10000000000
                AND VALUE < 10000000000
                AND VALUE = trunc(VALUE, 8)
            );
    END IF;
END;
$$;

ALTER TABLE inventory.stock_positions
    ALTER COLUMN on_hand DROP DEFAULT,
    ALTER COLUMN reserved DROP DEFAULT,
    ALTER COLUMN allocated DROP DEFAULT;

ALTER TABLE inventory.stock_positions
    ALTER COLUMN on_hand TYPE inventory.quantity_18_8
        USING on_hand::numeric::inventory.quantity_18_8,
    ALTER COLUMN reserved TYPE inventory.quantity_18_8
        USING reserved::numeric::inventory.quantity_18_8,
    ALTER COLUMN allocated TYPE inventory.quantity_18_8
        USING allocated::numeric::inventory.quantity_18_8;

ALTER TABLE inventory.stock_positions
    ALTER COLUMN on_hand SET DEFAULT '0',
    ALTER COLUMN reserved SET DEFAULT '0',
    ALTER COLUMN allocated SET DEFAULT '0';

ALTER TABLE inventory.fifo_layers
    ALTER COLUMN quantity TYPE inventory.quantity_18_8
        USING quantity::numeric::inventory.quantity_18_8,
    ALTER COLUMN remaining_quantity TYPE inventory.quantity_18_8
        USING remaining_quantity::numeric::inventory.quantity_18_8;

ALTER TABLE inventory.ledger_entries
    ALTER COLUMN quantity_change TYPE inventory.quantity_18_8
        USING quantity_change::numeric::inventory.quantity_18_8;

ALTER TABLE inventory.reservation_items
    ALTER COLUMN quantity TYPE inventory.quantity_18_8
        USING quantity::numeric::inventory.quantity_18_8;

ALTER TABLE inventory.stock_transfer_items
    ALTER COLUMN quantity TYPE inventory.quantity_18_8
        USING quantity::numeric::inventory.quantity_18_8,
    ALTER COLUMN received_quantity TYPE inventory.quantity_18_8
        USING received_quantity::numeric::inventory.quantity_18_8;

ALTER TABLE inventory.stock_adjustments
    ALTER COLUMN quantity_before TYPE inventory.quantity_18_8
        USING quantity_before::numeric::inventory.quantity_18_8,
    ALTER COLUMN quantity_after TYPE inventory.quantity_18_8
        USING quantity_after::numeric::inventory.quantity_18_8;

-- ============================================================================
-- Inventory reservation root: one logical reservation, one warehouse
-- ============================================================================

ALTER TABLE inventory.reservations
    ALTER COLUMN stock_position_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS branch_id uuid,
    ADD COLUMN IF NOT EXISTS warehouse_id uuid,
    ADD COLUMN IF NOT EXISTS reference_version integer NOT NULL DEFAULT 0;

-- Preserve and scope every legacy single-position reservation before enforcing
-- the new grouped-reservation root shape.
UPDATE inventory.reservations AS reservation
   SET warehouse_id = COALESCE(reservation.warehouse_id, stock_position.warehouse_id),
       branch_id = COALESCE(reservation.branch_id, warehouse.branch_id)
  FROM inventory.stock_positions AS stock_position
  JOIN organization.warehouses AS warehouse
    ON warehouse.id = stock_position.warehouse_id
   AND warehouse.organization_id = stock_position.organization_id
 WHERE reservation.stock_position_id = stock_position.id
   AND reservation.organization_id = stock_position.organization_id
   AND (reservation.warehouse_id IS NULL OR reservation.branch_id IS NULL);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM inventory.reservations
         WHERE warehouse_id IS NULL OR branch_id IS NULL
    ) THEN
        RAISE EXCEPTION 'Cannot scope existing Inventory reservations to a branch and warehouse.';
    END IF;
END;
$$;

-- Compatibility for old single-position inserts: omitted scope is derived from
-- stock_position_id. New grouped reservations (null root stock position) must
-- provide branch_id and warehouse_id explicitly.
CREATE OR REPLACE FUNCTION inventory.populate_reservation_scope_from_stock_position()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    derived_warehouse_id uuid;
    derived_branch_id uuid;
BEGIN
    IF NEW.stock_position_id IS NOT NULL THEN
        SELECT stock_position.warehouse_id, warehouse.branch_id
          INTO derived_warehouse_id, derived_branch_id
          FROM inventory.stock_positions AS stock_position
          JOIN organization.warehouses AS warehouse
            ON warehouse.id = stock_position.warehouse_id
           AND warehouse.organization_id = stock_position.organization_id
         WHERE stock_position.id = NEW.stock_position_id
           AND stock_position.organization_id = NEW.organization_id
         FOR SHARE OF stock_position, warehouse;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Reservation stock position must belong to the reservation tenant.'
                USING ERRCODE = '23503',
                      CONSTRAINT = 'reservations_stock_position_tenant_fk';
        END IF;

        IF NEW.warehouse_id IS NULL THEN
            NEW.warehouse_id := derived_warehouse_id;
        ELSIF NEW.warehouse_id <> derived_warehouse_id THEN
            RAISE EXCEPTION 'Reservation stock position must belong to the reservation warehouse.'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'reservations_stock_position_warehouse_check';
        END IF;

        IF NEW.branch_id IS NULL THEN
            NEW.branch_id := derived_branch_id;
        ELSIF NEW.branch_id <> derived_branch_id THEN
            RAISE EXCEPTION 'Reservation stock position must belong to the reservation branch.'
                USING ERRCODE = '23514',
                      CONSTRAINT = 'reservations_stock_position_branch_check';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservations_populate_scope_trigger ON inventory.reservations;
CREATE TRIGGER reservations_populate_scope_trigger
    BEFORE INSERT OR UPDATE OF organization_id, stock_position_id, branch_id, warehouse_id
    ON inventory.reservations
    FOR EACH ROW
    EXECUTE FUNCTION inventory.populate_reservation_scope_from_stock_position();

ALTER TABLE inventory.reservations
    ALTER COLUMN branch_id SET DEFAULT NULL,
    ALTER COLUMN branch_id SET NOT NULL,
    ALTER COLUMN warehouse_id SET DEFAULT NULL,
    ALTER COLUMN warehouse_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'reservations_status_check'
           AND conrelid = 'inventory.reservations'::regclass
    ) THEN
        ALTER TABLE inventory.reservations
            ADD CONSTRAINT reservations_status_check
            CHECK (status IN ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED')) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'reservations_reference_version_check'
           AND conrelid = 'inventory.reservations'::regclass
    ) THEN
        ALTER TABLE inventory.reservations
            ADD CONSTRAINT reservations_reference_version_check
            CHECK (reference_version >= 0) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'reservations_branch_tenant_fk'
           AND conrelid = 'inventory.reservations'::regclass
    ) THEN
        ALTER TABLE inventory.reservations
            ADD CONSTRAINT reservations_branch_tenant_fk
            FOREIGN KEY (branch_id, organization_id)
            REFERENCES organization.branches(id, organization_id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'reservations_warehouse_tenant_branch_fk'
           AND conrelid = 'inventory.reservations'::regclass
    ) THEN
        ALTER TABLE inventory.reservations
            ADD CONSTRAINT reservations_warehouse_tenant_branch_fk
            FOREIGN KEY (warehouse_id, organization_id, branch_id)
            REFERENCES organization.warehouses(id, organization_id, branch_id)
            NOT VALID;
    END IF;
END;
$$;

ALTER TABLE inventory.reservations VALIDATE CONSTRAINT reservations_status_check;
ALTER TABLE inventory.reservations VALIDATE CONSTRAINT reservations_reference_version_check;
ALTER TABLE inventory.reservations VALIDATE CONSTRAINT reservations_branch_tenant_fk;
ALTER TABLE inventory.reservations VALIDATE CONSTRAINT reservations_warehouse_tenant_branch_fk;

CREATE INDEX IF NOT EXISTS reservations_org_warehouse_status_idx
    ON inventory.reservations (organization_id, warehouse_id, status);

CREATE INDEX IF NOT EXISTS reservations_active_due_expiration_idx
    ON inventory.reservations (expires_at, id)
    WHERE status = 'ACTIVE' AND expires_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS reservations_active_reference_unique
    ON inventory.reservations (organization_id, reference_type, reference_id)
    WHERE status = 'ACTIVE' AND reference_type IS NOT NULL AND reference_id IS NOT NULL;

-- ============================================================================
-- Reservation items: each demand owns its exact stock-position reference
-- ============================================================================

ALTER TABLE inventory.reservation_items
    ADD COLUMN IF NOT EXISTS stock_position_id uuid;

UPDATE inventory.reservation_items AS item
   SET stock_position_id = reservation.stock_position_id
  FROM inventory.reservations AS reservation
 WHERE item.reservation_id = reservation.id
   AND item.organization_id = reservation.organization_id
   AND item.stock_position_id IS NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM inventory.reservation_items
         WHERE stock_position_id IS NULL
    ) THEN
        RAISE EXCEPTION 'Cannot backfill a stock position for an existing reservation item.';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM inventory.reservation_items AS item
          JOIN inventory.reservations AS reservation
            ON reservation.id = item.reservation_id
           AND reservation.organization_id = item.organization_id
          JOIN inventory.stock_positions AS stock_position
            ON stock_position.id = item.stock_position_id
           AND stock_position.organization_id = item.organization_id
         WHERE stock_position.warehouse_id <> reservation.warehouse_id
            OR stock_position.variant_id <> item.variant_id
    ) THEN
        RAISE EXCEPTION 'Existing reservation item does not match its reservation warehouse or variant.';
    END IF;
END;
$$;

-- Compatibility for old item inserts: a missing position is derived only when
-- the parent is a legacy single-position reservation. Grouped callers must send
-- the position for every item. The same trigger enforces one warehouse and the
-- item/position variant match for both shapes.
CREATE OR REPLACE FUNCTION inventory.enforce_reservation_item_position_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    reservation_warehouse_id uuid;
    legacy_stock_position_id uuid;
    item_warehouse_id uuid;
    item_variant_id uuid;
BEGIN
    SELECT reservation.warehouse_id, reservation.stock_position_id
      INTO reservation_warehouse_id, legacy_stock_position_id
      FROM inventory.reservations AS reservation
     WHERE reservation.id = NEW.reservation_id
       AND reservation.organization_id = NEW.organization_id
     FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reservation item parent must belong to the item tenant.'
            USING ERRCODE = '23503',
                  CONSTRAINT = 'reservation_items_reservation_tenant_fk';
    END IF;

    IF NEW.stock_position_id IS NULL THEN
        NEW.stock_position_id := legacy_stock_position_id;
    END IF;

    IF NEW.stock_position_id IS NULL THEN
        RAISE EXCEPTION 'Grouped reservation items require stock_position_id.'
            USING ERRCODE = '23502',
                  COLUMN = 'stock_position_id';
    END IF;

    SELECT stock_position.warehouse_id, stock_position.variant_id
      INTO item_warehouse_id, item_variant_id
      FROM inventory.stock_positions AS stock_position
     WHERE stock_position.id = NEW.stock_position_id
       AND stock_position.organization_id = NEW.organization_id
     FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reservation item stock position must belong to the item tenant.'
            USING ERRCODE = '23503',
                  CONSTRAINT = 'reservation_items_stock_position_tenant_fk';
    END IF;

    IF item_warehouse_id <> reservation_warehouse_id THEN
        RAISE EXCEPTION 'All reservation items must belong to the reservation warehouse.'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'reservation_items_reservation_warehouse_check';
    END IF;

    IF item_variant_id <> NEW.variant_id THEN
        RAISE EXCEPTION 'Reservation item variant must match its stock position.'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'reservation_items_stock_position_variant_check';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservation_items_position_scope_trigger
    ON inventory.reservation_items;
CREATE TRIGGER reservation_items_position_scope_trigger
    BEFORE INSERT OR UPDATE OF organization_id, reservation_id, stock_position_id, variant_id
    ON inventory.reservation_items
    FOR EACH ROW
    EXECUTE FUNCTION inventory.enforce_reservation_item_position_scope();

ALTER TABLE inventory.reservation_items
    ALTER COLUMN stock_position_id SET DEFAULT NULL,
    ALTER COLUMN stock_position_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'reservation_items_quantity_positive_check'
           AND conrelid = 'inventory.reservation_items'::regclass
    ) THEN
        ALTER TABLE inventory.reservation_items
            ADD CONSTRAINT reservation_items_quantity_positive_check
            CHECK (quantity > 0) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'reservation_items_stock_position_tenant_fk'
           AND conrelid = 'inventory.reservation_items'::regclass
    ) THEN
        ALTER TABLE inventory.reservation_items
            ADD CONSTRAINT reservation_items_stock_position_tenant_fk
            FOREIGN KEY (stock_position_id, organization_id)
            REFERENCES inventory.stock_positions(id, organization_id)
            NOT VALID;
    END IF;
END;
$$;

ALTER TABLE inventory.reservation_items
    VALIDATE CONSTRAINT reservation_items_quantity_positive_check;
ALTER TABLE inventory.reservation_items
    VALIDATE CONSTRAINT reservation_items_stock_position_tenant_fk;

CREATE INDEX IF NOT EXISTS reservation_items_stock_position_id_idx
    ON inventory.reservation_items (stock_position_id);

CREATE UNIQUE INDEX IF NOT EXISTS reservation_items_reservation_stock_position_unique
    ON inventory.reservation_items (organization_id, reservation_id, stock_position_id);
