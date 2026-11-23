/** Broker answers that only come in as a tap on the WhatsApp requirement (LS_N_0105 / LS_N_0106):
 *  Negotiate / Give rate — the broker was asked for a rate and hasn't sent it yet. Saved in the
 *  broker's history beside the responses Placement logs by hand (BROKER_RESPONSES); not accepted
 *  from Placement's "Log bid" form. */
export const WHATSAPP_ONLY_BROKER_RESPONSES = ['negotiating'] as const;

/** Where a Loadsmart load stands for one partner — what a WhatsApp reply that can't be taken
 *  is told: still bidding (rate with the customer), won and waiting for the driver, the truck and
 *  driver already confirmed (memo accepted or the trip under way), given to another truck, or
 *  cancelled. */
export const PARTNER_LOAD_STATUSES = [
  'bidding',
  'awaiting_driver',
  'driver_confirmed',
  'given_to_other',
  'cancelled',
] as const;
