/** Channels supported by the Cart context. M5 exposes only POS on the POS surface. */
export const CART_CHANNELS = ['ONLINE', 'POS', 'SALES'] as const;
export type CartChannel = (typeof CART_CHANNELS)[number];

/** M5 persists editable Draft carts; later terminal states are additive. */
export const CART_STATUSES = ['DRAFT', 'CHECKED_OUT'] as const;
export type CartStatus = (typeof CART_STATUSES)[number];
