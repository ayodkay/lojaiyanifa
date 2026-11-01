// Cart limits shared by the browser cart (localStorage) and the server quote.
// No imports on purpose: this module is bundled into both.

/** Most units of one SKU in a cart line. */
export const MAX_LINE_QUANTITY = 99;

/** Most distinct lines in a cart (the quote API rejects larger payloads). */
export const MAX_CART_LINES = 50;
