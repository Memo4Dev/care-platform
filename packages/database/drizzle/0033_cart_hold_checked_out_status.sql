ALTER TABLE cart.cart_holds DROP CONSTRAINT IF EXISTS cart_holds_status_check;

ALTER TABLE cart.cart_holds
    ADD CONSTRAINT cart_holds_status_check
    CHECK (status IN ('PENDING', 'ACTIVE', 'RELEASING', 'RELEASED', 'EXPIRED', 'FAILED', 'CHECKED_OUT'));
