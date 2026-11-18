import { SUPPRESSED_REASONS } from './messaging.constants';
import { MessageIntent, MessageRecipientKind, PolicyChannel } from './messaging.types';

export interface ChannelPolicyInput {
  recipientKind: MessageRecipientKind;
  /** action = the recipient must act; update = information. null = not classified → no intent rule. */
  intent: MessageIntent | null;
  channels: readonly PolicyChannel[];
  /** The load the message is about, when there is one. */
  load?: {
    /** false for own-fleet trips, which have no load memo. */
    hasMemoStep: boolean;
    /** A load memo has been sent for this load. */
    memoSent: boolean;
  } | null;
  /** Drivers only: registered on the driver app. */
  driverHasApp?: boolean;
  /** A shipper message the catalog sends before the memo (LS_N_0067, LS_N_0103). */
  allowedBeforeMemo?: boolean;
}

export interface ChannelPolicyResult {
  channels: PolicyChannel[];
  suppressed: { channel: PolicyChannel; reason: string }[];
}

/**
 * The channel rules of the load module spec (p.30 "Channel rules", p.31–32 "Key messages"):
 * 1. Shipper: actions → WhatsApp + app; updates → app only (WhatsApp dropped; email/SMS stay where
 *    the type lists them — the rule is about WhatsApp's cost).
 * 2. Shipper: no WhatsApp about a load before its load memo (loads with a memo step only) —
 *    except the catalog's LS_N_0067 (Loadsmart's bid) and LS_N_0103 (bids received).
 * 3. Driver: the driver app if registered, else WhatsApp (SMS stays — the SIM consent link).
 * 4. Receiver: SMS only.
 * 5. Broker / transporter / Loadsmart partner: WhatsApp only.
 * A dropped channel comes back in `suppressed` with its reason, for the log.
 */
export function applyChannelPolicy(input: ChannelPolicyInput): ChannelPolicyResult {
  const kept: PolicyChannel[] = [];
  const suppressed: ChannelPolicyResult['suppressed'] = [];
  for (const channel of input.channels) {
    const reason = dropReason(input, channel);
    if (reason) suppressed.push({ channel, reason });
    else kept.push(channel);
  }
  return { channels: kept, suppressed };
}

function dropReason(input: ChannelPolicyInput, channel: PolicyChannel): string | null {
  switch (input.recipientKind) {
    case 'transporter':
    case 'partner':
      return channel === 'whatsapp' ? null : SUPPRESSED_REASONS.supplySideWhatsappOnly;
    case 'receiver':
      return channel === 'sms' ? null : SUPPRESSED_REASONS.receiverSmsOnly;
    case 'driver':
      if (channel === 'whatsapp' && input.driverHasApp) return SUPPRESSED_REASONS.driverUsesApp;
      return null;
    case 'shipper_user':
      if (channel !== 'whatsapp') return null;
      if (input.intent === 'update') return SUPPRESSED_REASONS.updateAppOnly;
      if (input.load?.hasMemoStep && !input.load.memoSent && !input.allowedBeforeMemo) {
        return SUPPRESSED_REASONS.beforeLoadMemo;
      }
      return null;
    default:
      return null;
  }
}
