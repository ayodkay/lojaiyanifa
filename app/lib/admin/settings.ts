// /admin/settings: limits shared by the page (input attributes, hints) and the server, which parses the forms
// (app/.server/settings-forms.ts) and saves them (app/.server/admin-settings.ts).

/** Delivery method names, as customers see them at checkout. */
export const LABEL_MAX = 60;
export const ADDRESS_MAX = 300;
export const INSTRUCTIONS_MAX = 500;
/** Receiver name and city as typed (accents allowed). The Pix code then carries at most PIX_NAME_MAX / PIX_CITY_MAX. */
export const RECEIVER_INPUT_MAX = 60;
/** Same bounds as paymentSettingsSchema.expiryHours. */
export const EXPIRY_HOURS = { min: 1, max: 168 } as const;
/** Same bound as shippingSettingsSchema.handlingDays. */
export const HANDLING_DAYS_MAX = 30;
export const TRANSIT_DAYS_MAX = 60;

/** The test code on the page: R$ 1,00 to the stored key, with a txid no order can have (orders use PEDIDO<n>). */
export const TEST_AMOUNT_CENTS = 100;
export const TEST_TXID = "TESTE";
