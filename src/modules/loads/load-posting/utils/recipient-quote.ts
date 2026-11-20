import type { LoadEntity } from '../../entities/load.entity';
import type { LoadBidEntity } from '../../bids/load-bid.entity';
import { effectiveBidStatus } from '../../bids/bid-rules';
import type { LoadRecipientEntity } from '../entities/load-recipient.entity';
import type { RecipientQuote } from './load-posting.interface';
import { QUOTE_NO_ANSWER_CALL_AFTER_MS } from './load-posting.types';

type QuoteLoad = Pick<LoadEntity, 'status' | 'awardedBidId'>;

/**
 * Where one transporter is on one load, for the shipper's "Who is quoting" row — pure, from what
 * is already stored: its bid on this load (exact per load), else its WhatsApp answer, else how
 * far the offer got (delivered / read / failed). The answer and the delivery are kept per
 * posting, so a multi-truck posting shows them on each of its loads.
 */
export function recipientQuoteOf(
  recipient: Pick<
    LoadRecipientEntity,
    | 'messageStatus'
    | 'sentAt'
    | 'deliveredAt'
    | 'readAt'
    | 'replyStatus'
    | 'repliedAt'
    | 'createdAt'
  >,
  bid: LoadBidEntity | null,
  load: QuoteLoad,
  now: Date,
): RecipientQuote {
  const open = (load.status === 'created' || load.status === 'bids_received') && !load.awardedBidId;

  if (bid) {
    const status = effectiveBidStatus(bid, now);
    const at = bid.updatedAt;
    if (status === 'accepted') return { step: 'awarded', stepAt: at, needsCall: false };
    if (status === 'rejected')
      return {
        step: load.awardedBidId ? 'not_chosen' : 'bid_rejected',
        stepAt: at,
        needsCall: false,
      };
    if (status === 'expired')
      return { step: 'bid_expired', stepAt: bid.expiresAt, needsCall: false };
    if (bid.counterStatus === 'pending')
      return { step: 'countered', stepAt: bid.counteredAt ?? at, needsCall: false };
    return {
      step: bid.vehicleNumber ? 'bid_with_truck' : 'bid_no_truck',
      stepAt: at,
      needsCall: false,
    };
  }

  if (!open) return { step: 'closed', stepAt: null, needsCall: false };
  if (recipient.replyStatus)
    return { step: recipient.replyStatus, stepAt: recipient.repliedAt, needsCall: false };
  if (recipient.messageStatus === 'failed')
    return { step: 'not_delivered', stepAt: null, needsCall: false };
  if (recipient.messageStatus === 'pending')
    return { step: 'sending', stepAt: recipient.createdAt, needsCall: false };

  const step = recipient.readAt ? 'seen' : recipient.deliveredAt ? 'delivered' : 'sent';
  const stepAt = recipient.readAt ?? recipient.deliveredAt ?? recipient.sentAt;
  const waitedMs = stepAt ? now.getTime() - stepAt.getTime() : 0;
  return { step, stepAt, needsCall: waitedMs >= QUOTE_NO_ANSWER_CALL_AFTER_MS };
}
