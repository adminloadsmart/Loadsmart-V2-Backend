import { DELIVERY_STATUS_RANK } from '../messaging.constants';
import { MessageLogStatus } from '../messaging.types';
import { MessageLogEntity } from '../entities/message-log.entity';
import { NormalizedStatus } from '../providers/whatsapp-provider.interface';
import { MessageLogPatch } from '../repositories/message-log.repository';

type RankedStatus = keyof typeof DELIVERY_STATUS_RANK;

const rankOf = (status: MessageLogStatus): number =>
  status in DELIVERY_STATUS_RANK ? DELIVERY_STATUS_RANK[status as RankedStatus] : 0;

/**
 * The change a delivery status makes to a message_log row, or null when it changes nothing.
 * Rules (live findings L2, L12, R9): statuses only move forward; `read` also fills `delivered_at`
 * and `sent_at` (Meta often skips `delivered`); each timestamp is set once, from the provider's
 * timestamp; `failed` never overrides a message already delivered/read; `deleted` is recorded as-is.
 */
export function planStatusUpdate(
  current: Pick<MessageLogEntity, 'status' | 'sentAt' | 'deliveredAt' | 'readAt' | 'failedAt'>,
  event: Pick<NormalizedStatus, 'status' | 'timestamp' | 'error'>,
): MessageLogPatch | null {
  const patch: MessageLogPatch = {};

  if (event.status === 'deleted') {
    return current.status === 'deleted' ? null : { status: 'deleted' };
  }

  if (event.status === 'failed') {
    if (rankOf(current.status) >= DELIVERY_STATUS_RANK.delivered || current.failedAt) return null;
    return {
      status: 'failed',
      failedAt: event.timestamp,
      error: event.error ? { code: event.error.code, title: event.error.title } : null,
    };
  }

  if (!current.sentAt) patch.sentAt = event.timestamp;
  if (event.status !== 'sent' && !current.deliveredAt) patch.deliveredAt = event.timestamp;
  if (event.status === 'read' && !current.readAt) patch.readAt = event.timestamp;
  if (rankOf(event.status) > rankOf(current.status) && current.status !== 'failed') {
    patch.status = event.status;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}
