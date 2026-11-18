export const BROKER_STATUSES = ['approved', 'awaiting_approval', 'on_hold', 'rejected'] as const;
export type BrokerStatus = (typeof BROKER_STATUSES)[number];
