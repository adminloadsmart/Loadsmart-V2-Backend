import { MessageStatus, PostMode, PriceMode } from './utils/load-posting.types';

export interface DispatchRecipient {
  recipientId: string;
  type: 'loadsmart' | 'transporter';
  name: string;
  /** WhatsApp number — null for Loadsmart itself, which is reached via the admin console. */
  phone: string | null;
}

/** The posting as a structured offer — what a WhatsApp template needs (one offer per load, so
 *  every reply names one load). Never carries the shipper's or customer's name. */
export interface DispatchOffer {
  mode: PostMode;
  priceMode: PriceMode | null;
  /** Target rate (market, set_target) or contract rate (indent); null when quotes are asked. */
  rate: string | null;
  pickupLabel: string;
  dropLabel: string;
  truckLabel: string;
  /** Load weight in tonnes, as posted (null when not given). */
  weightTonnes: string | null;
  pickupAt: Date;
  loads: { loadId: string; loadCode: string }[];
}

export interface DispatchMessage {
  tenantId: string;
  postingId: string;
  text: string;
  recipients: DispatchRecipient[];
  offer?: DispatchOffer;
}

export interface DispatchResult {
  recipientId: string;
  status: MessageStatus;
}

/**
 * How a posted load reaches transporters. Posting depends on this interface only; the WhatsApp
 * sender (messaging/integration/whatsapp-dispatch-notifier.ts) replaces the logging default
 * without touching LoadPostingService. Implementations must not throw for a delivery failure —
 * report it as `failed` for that recipient; the load is already posted.
 */
export interface LoadDispatchNotifier {
  send(message: DispatchMessage): Promise<DispatchResult[]>;
}

/** Placeholder until WhatsApp delivery is built: logs the message and leaves every recipient
 *  `pending` — it never claims a message was sent. */
export class LoggingLoadDispatchNotifier implements LoadDispatchNotifier {
  async send(message: DispatchMessage): Promise<DispatchResult[]> {
    console.info(
      `[load-posting] posting ${message.postingId} queued for ${message.recipients.length} recipient(s)`,
    );
    return message.recipients.map((recipient) => ({
      recipientId: recipient.recipientId,
      status: 'pending' as const,
    }));
  }
}
