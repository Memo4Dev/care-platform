-- ============================================================================
-- M3-001: Inventory Core Persistence
-- ============================================================================
-- Creates logical schema `inventory` with all core tables:
--   stock_positions, fifo_layers, ledger_entries, reservations,
--   reservation_items, allocations, stock_transfers, stock_transfer_items,
--   stock_adjustments.
--
-- Conventions:
--   - Every tenant-owned row carries organization_id (tenant boundary).
--   - Composite tenant FKs: (parent_id, organization_id) → parent(id, organization_id).
--   - Quantities/costs are decimal(14,4), never float.
--   - CHECK constraints enforce non-negative balances.
--   - Partial index on fifo_layers for FIFO consumption query.
--   - All DDL is idempotent (IF NOT EXISTS).
-- ============================================================================

-- Create logical schema if it does not exist
CREATE SCHEMA IF NOT EXISTS inventory;

-- ============================================================================
-- Prerequisite: Add composite tenant scope unique on organization.warehouses
-- (mirrors branches_tenant_scope_unique pattern from 0000_concerned_tana_nile.sql)
-- Required by inventory FK references: (warehouse_id, organization_id) → warehouses(id, organization_id)
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS warehouses_tenant_scope_unique
  ON organization.warehouses (id, organization_id);

-- ============================================================================
-- stock_positions — Core Aggregate Identity
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.stock_positions (
    id                uuid PRIMARY KEY,
    organization_id   uuid NOT NULL REFERENCES organization.organizations(id) ON DELETE CASCADE,
    warehouse_id      uuid NOT NULL,
    variant_id        uuid NOT NULL,
    on_hand           decimal(14,4) NOT NULL DEFAULT '0',
    reserved          decimal(14,4) NOT NULL DEFAULT '0',
    allocated         decimal(14,4) NOT NULL DEFAULT '0',
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    version           integer NOT NULL DEFAULT 1,

    CONSTRAINT stock_positions_non_negative_on_hand CHECK (on_hand >= 0),
    CONSTRAINT stock_positions_non_negative_reserved CHECK (reserved >= 0),
    CONSTRAINT stock_positions_non_negative_allocated CHECK (allocated >= 0),
    CONSTRAINT stock_positions_reserved_within_on_hand CHECK (reserved + allocated <= on_hand),

    CONSTRAINT stock_positions_warehouse_tenant_fk
        FOREIGN KEY (warehouse_id, organization_id)
        REFERENCES organization.warehouses(id, organization_id)
        ON DELETE CASCADE,

    CONSTRAINT stock_positions_variant_tenant_fk
        FOREIGN KEY (variant_id, organization_id)
        REFERENCES catalog.product_variants(id, organization_id)
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS stock_positions_org_warehouse_variant_unique
    ON inventory.stock_positions (organization_id, warehouse_id, variant_id);

CREATE INDEX IF NOT EXISTS stock_positions_organization_id_idx
    ON inventory.stock_positions (organization_id);

CREATE INDEX IF NOT EXISTS stock_positions_org_warehouse_idx
    ON inventory.stock_positions (organization_id, warehouse_id);

-- ============================================================================
-- fifo_layers — FIFO Cost Layers
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.fifo_layers (
    id                  uuid PRIMARY KEY,
    organization_id     uuid NOT NULL REFERENCES organization.organizations(id) ON DELETE CASCADE,
    stock_position_id   uuid NOT NULL,
    received_at         timestamptz NOT NULL DEFAULT now(),
    quantity            decimal(14,4) NOT NULL,
    remaining_quantity  decimal(14,4) NOT NULL,
    unit_cost           decimal(14,4) NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fifo_layers_stock_position_tenant_fk
        FOREIGN KEY (stock_position_id, organization_id)
        REFERENCES inventory.stock_positions(id, organization_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS fifo_layers_stock_position_id_idx
    ON inventory.fifo_layers (stock_position_id);

-- Partial index for FIFO consumption: only active layers
-- Joins through stock_positions to get (organization_id, warehouse_id, variant_id)
-- This accelerates the oldest-first consumption query.
CREATE INDEX IF NOT EXISTS fifo_layers_consumption_idx
    ON inventory.fifo_layers (organization_id, stock_position_id, received_at, id)
    WHERE remaining_quantity > 0;

-- ============================================================================
-- ledger_entries — Immutable History (append-only)
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.ledger_entries (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   uuid NOT NULL REFERENCES organization.organizations(id) ON DELETE CASCADE,
    stock_position_id uuid NOT NULL,
    entry_type        text NOT NULL,
    quantity_change   decimal(14,4) NOT NULL,
    reference_type    text,
    reference_id      uuid,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ledger_entries_stock_position_tenant_fk
        FOREIGN KEY (stock_position_id, organization_id)
        REFERENCES inventory.stock_positions(id, organization_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ledger_entries_organization_id_idx
    ON inventory.ledger_entries (organization_id);

CREATE INDEX IF NOT EXISTS ledger_entries_stock_position_id_idx
    ON inventory.ledger_entries (stock_position_id);

CREATE INDEX IF NOT EXISTS ledger_entries_reference_idx
    ON inventory.ledger_entries (reference_type, reference_id);

-- ============================================================================
-- reservations — Hold Stock
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.reservations (
    id                uuid PRIMARY KEY,
    organization_id   uuid NOT NULL REFERENCES organization.organizations(id) ON DELETE CASCADE,
    stock_position_id uuid NOT NULL,
    status            text NOT NULL DEFAULT 'ACTIVE',
    expires_at        timestamptz,
    reference_type    text,
    reference_id      uuid,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    version           integer NOT NULL DEFAULT 1,

    CONSTRAINT reservations_stock_position_tenant_fk
        FOREIGN KEY (stock_position_id, organization_id)
        REFERENCES inventory.stock_positions(id, organization_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS reservations_organization_id_idx
    ON inventory.reservations (organization_id);

CREATE INDEX IF NOT EXISTS reservations_stock_position_id_idx
    ON inventory.reservations (stock_position_id);

CREATE INDEX IF NOT EXISTS reservations_status_idx
    ON inventory.reservations (status);

-- ============================================================================
-- reservation_items — Line Items Within a Reservation
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.reservation_items (
    id                uuid PRIMARY KEY,
    organization_id   uuid NOT NULL REFERENCES organization.organizations(id) ON DELETE CASCADE,
    reservation_id    uuid NOT NULL,
    variant_id        uuid NOT NULL,
    quantity          decimal(14,4) NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT reservation_items_reservation_tenant_fk
        FOREIGN KEY (reservation_id, organization_id)
        REFERENCES inventory.reservations(id, organization_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS reservation_items_reservation_id_idx
    ON inventory.reservation_items (reservation_id);

-- ============================================================================
-- allocations — Committed Stock
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.allocations (
    id                uuid PRIMARY KEY,
    organization_id   uuid NOT NULL REFERENCES organization.organizations(id) ON DELETE CASCADE,
    stock_position_id uuid NOT NULL,
    status            text NOT NULL DEFAULT 'ACTIVE',
    expires_at        timestamptz,
    reference_type    text,
    reference_id      uuid,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    version           integer NOT NULL DEFAULT 1,

    CONSTRAINT allocations_stock_position_tenant_fk
        FOREIGN KEY (stock_position_id, organization_id)
        REFERENCES inventory.stock_positions(id, organization_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS allocations_organization_id_idx
    ON inventory.allocations (organization_id);

CREATE INDEX IF NOT EXISTS allocations_stock_position_id_idx
    ON inventory.allocations (stock_position_id);

CREATE INDEX IF NOT EXISTS allocations_status_idx
    ON inventory.allocations (status);

-- ============================================================================
-- stock_transfers — Move Stock Between Warehouses
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.stock_transfers (
    id                       uuid PRIMARY KEY,
    organization_id          uuid NOT NULL REFERENCES organization.organizations(id) ON DELETE CASCADE,
    source_warehouse_id      uuid NOT NULL,
    destination_warehouse_id uuid NOT NULL,
    status                   text NOT NULL DEFAULT 'DRAFT',
    dispatched_at            timestamptz,
    received_at              timestamptz,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    version                  integer NOT NULL DEFAULT 1,

    CONSTRAINT stock_transfers_source_warehouse_tenant_fk
        FOREIGN KEY (source_warehouse_id, organization_id)
        REFERENCES organization.warehouses(id, organization_id)
        ON DELETE CASCADE,

    CONSTRAINT stock_transfers_dest_warehouse_tenant_fk
        FOREIGN KEY (destination_warehouse_id, organization_id)
        REFERENCES organization.warehouses(id, organization_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS stock_transfers_organization_id_idx
    ON inventory.stock_transfers (organization_id);

CREATE INDEX IF NOT EXISTS stock_transfers_source_warehouse_id_idx
    ON inventory.stock_transfers (source_warehouse_id);

CREATE INDEX IF NOT EXISTS stock_transfers_destination_warehouse_id_idx
    ON inventory.stock_transfers (destination_warehouse_id);

CREATE INDEX IF NOT EXISTS stock_transfers_status_idx
    ON inventory.stock_transfers (status);

-- ============================================================================
-- stock_transfer_items — Line Items in a Transfer
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.stock_transfer_items (
    id                uuid PRIMARY KEY,
    organization_id   uuid NOT NULL REFERENCES organization.organizations(id) ON DELETE CASCADE,
    transfer_id       uuid NOT NULL,
    variant_id        uuid NOT NULL,
    quantity          decimal(14,4) NOT NULL,
    received_quantity decimal(14,4),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT stock_transfer_items_transfer_tenant_fk
        FOREIGN KEY (transfer_id, organization_id)
        REFERENCES inventory.stock_transfers(id, organization_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS stock_transfer_items_transfer_id_idx
    ON inventory.stock_transfer_items (transfer_id);

-- ============================================================================
-- stock_adjustments — Audit Trail for Corrections
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.stock_adjustments (
    id                uuid PRIMARY KEY,
    organization_id   uuid NOT NULL REFERENCES organization.organizations(id) ON DELETE CASCADE,
    stock_position_id uuid NOT NULL,
    adjustment_type   text NOT NULL,
    quantity_before   decimal(14,4) NOT NULL,
    quantity_after    decimal(14,4) NOT NULL,
    reason            text NOT NULL,
    approved_by       uuid,
    reference_type    text,
    reference_id      uuid,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT stock_adjustments_stock_position_tenant_fk
        FOREIGN KEY (stock_position_id, organization_id)
        REFERENCES inventory.stock_positions(id, organization_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS stock_adjustments_organization_id_idx
    ON inventory.stock_adjustments (organization_id);

CREATE INDEX IF NOT EXISTS stock_adjustments_stock_position_id_idx
    ON inventory.stock_adjustments (stock_position_id);
