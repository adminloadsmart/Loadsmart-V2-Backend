import { MessageStatus } from './utils/load-posting.types';

export interface DispatchRecipient {
  recipientId: string;
  type: 'loadsmart' | 'transporter';
  name: string;
  /** WhatsApp number — null for Loadsmart itself, which is reached via the admin console. */
  phone: string | null;
}

export interface DispatchMessage {
  tenantId: string;
  postingId: string;
  text: string;
  recipients: DispatchRecipient[];
}

export interface DispatchResult {
  recipientId: string;
  status: MessageStatus;
}

/**
 * How a posted load reaches transporters. Posting depends on this interface only, so the real
 * WhatsApp sender (MSG91 templates via the notifications module) can replace the logging default
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
