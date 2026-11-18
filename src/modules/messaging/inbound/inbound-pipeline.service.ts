import { JobQueue } from '../../../jobs/queue-registry';
import { WhatsappInboundEntity } from '../entities/whatsapp-inbound.entity';
import { MessageLogEntity } from '../entities/message-log.entity';
import {
  INBOUND_JOB_NAMES,
  INBOUND_JOB_RETRY,
  STATUS_LOCK_PREFIX,
  STATUS_MATCH_WINDOW_MS,
} from '../messaging.constants';
import { DeliveryStatusEvent, WhatsappProviderName } from '../messaging.types';
import {
  NormalizedEvent,
  NormalizedMessage,
  NormalizedStatus,
} from '../providers/whatsapp-provider.interface';
import { InboundResolutionPatch } from '../repositories/whatsapp-inbound.repository';
import { MessageLogPatch } from '../repositories/message-log.repository';
import { planStatusUpdate } from './delivery-status';

/** Decides what an inbound message means (Part 3: the reply router). Must not return 'pending'. */
export interface InboundMessageHandler {
  handle(inbound: WhatsappInboundEntity): Promise<InboundResolutionPatch>;
}

export interface InboundStore {
  insertIfNew(message: NormalizedMessage): Promise<WhatsappInboundEntity | null>;
  findById(inboundId: string): Promise<WhatsappInboundEntity | null>;
  findPendingForSender(fromPhone: string, upTo: Date): Promise<WhatsappInboundEntity[]>;
  recordResolution(inboundId: string, patch: InboundResolutionPatch): Promise<void>;
}

export interface MessageLogStore {
  findByProviderMessageId(providerMessageId: string): Promise<MessageLogEntity | null>;
  findAwaitingMessageIdByRequestId(providerRequestId: string): Promise<MessageLogEntity | null>;
  /** The latest message to this number, sent since `since`, whose WAMID hasn't come yet. */
  findAwaitingMessageIdByAddress(address: string, since: Date): Promise<MessageLogEntity | null>;
  update(messageLogId: string, patch: MessageLogPatch): Promise<void>;
}

/** Told after a delivery status changed a message_log row (e.g. to mark load_recipients sent). */
export interface DeliveryStatusListener {
  onStatusApplied(messageLog: MessageLogEntity, patch: MessageLogPatch): Promise<void>;
}

/** Per-sender mutual exclusion (Redis in production). Returns a token, or null when busy. */
export interface SenderLock {
  acquire(senderPhone: string): Promise<string | null>;
  release(senderPhone: string, token: string): Promise<void>;
}

export interface ProcessSenderJobPayload {
  inboundId: string;
}

export interface ApplyStatusJobPayload {
  provider: WhatsappProviderName;
  providerMessageId: string | null;
  providerRequestId: string | null;
  /** The number the report is about (MSG91 `customerNumber`) — last-resort match (plan note 17). */
  recipientPhone?: string | null;
  status: DeliveryStatusEvent;
  timestamp: string;
  error: { code: string; title: string } | null;
}

/** Thrown when another worker holds the sender's lock — BullMQ retries the job shortly. */
export class SenderBusyError extends Error {
  constructor(senderPhone: string) {
    super(`WhatsApp sender ${senderPhone.slice(-4)} is being processed by another worker`);
    this.name = 'SenderBusyError';
  }
}

export interface AcceptedEventsSummary {
  storedMessages: number;
  duplicateMessages: number;
  statuses: number;
}

interface PipelineLogger {
  warn(message: string): void;
}

/**
 * Inbound side of WhatsApp, provider-neutral:
 * 1. acceptEvents (webhook request): store each message once (dedupe), queue the work, queue statuses.
 * 2. processSender (worker): under the sender's lock, handle that sender's pending messages in
 *    arrival order, so a typed value and its list pick never race (finding G2).
 * 3. applyStatus (worker): forward-only delivery statuses on message_log (+ request-id backfill).
 */
export class InboundPipelineService {
  constructor(
    private readonly inboundStore: InboundStore,
    private readonly messageLogStore: MessageLogStore,
    private readonly queue: JobQueue,
    private readonly senderLock: SenderLock,
    private handler: InboundMessageHandler,
    private readonly logger: PipelineLogger = console,
  ) {}

  /** Swaps the handler once the business side exists (the composition root builds loads after
   *  messaging, so the reply router is connected later). */
  useHandler(handler: InboundMessageHandler): void {
    this.handler = handler;
  }

  private readonly statusListeners: DeliveryStatusListener[] = [];

  addStatusListener(listener: DeliveryStatusListener): void {
    this.statusListeners.push(listener);
  }

  async acceptEvents(events: NormalizedEvent[]): Promise<AcceptedEventsSummary> {
    const summary: AcceptedEventsSummary = { storedMessages: 0, duplicateMessages: 0, statuses: 0 };
    for (const event of events) {
      if (event.kind === 'status') {
        await this.queue.enqueue(INBOUND_JOB_NAMES.applyStatus, toStatusPayload(event), {
          attempts: INBOUND_JOB_RETRY.attempts,
          backoff: { type: 'fixed', delay: INBOUND_JOB_RETRY.backoffMs },
        });
        summary.statuses += 1;
        continue;
      }
      const storedMessage = await this.inboundStore.insertIfNew(event);
      if (!storedMessage) {
        summary.duplicateMessages += 1;
        continue;
      }
      summary.storedMessages += 1;
      const payload: ProcessSenderJobPayload = { inboundId: storedMessage.id };
      await this.queue.enqueue(INBOUND_JOB_NAMES.processSender, payload, {
        jobId: storedMessage.id,
        attempts: INBOUND_JOB_RETRY.attempts,
        backoff: { type: 'fixed', delay: INBOUND_JOB_RETRY.backoffMs },
      });
    }
    return summary;
  }

  async processSender(payload: ProcessSenderJobPayload): Promise<number> {
    const triggeringMessage = await this.inboundStore.findById(payload.inboundId);
    if (!triggeringMessage || triggeringMessage.resolution !== 'pending') return 0;

    const senderPhone = triggeringMessage.fromPhone;
    const lockToken = await this.senderLock.acquire(senderPhone);
    if (!lockToken) throw new SenderBusyError(senderPhone);

    let handledCount = 0;
    try {
      const pendingMessages = await this.inboundStore.findPendingForSender(
        senderPhone,
        triggeringMessage.receivedAt,
      );
      for (const pendingMessage of pendingMessages) {
        await this.inboundStore.recordResolution(
          pendingMessage.id,
          await this.handleSafely(pendingMessage),
        );
        handledCount += 1;
      }
    } finally {
      await this.senderLock.release(senderPhone, lockToken);
    }
    return handledCount;
  }

  async applyStatus(
    payload: ApplyStatusJobPayload,
  ): Promise<'applied' | 'unchanged' | 'unknown_message'> {
    let messageLog = payload.providerMessageId
      ? await this.messageLogStore.findByProviderMessageId(payload.providerMessageId)
      : null;

    // Providers that return only a request id on send (MSG91): the first status carries the WAMID.
    if (!messageLog && payload.providerRequestId) {
      messageLog = await this.messageLogStore.findAwaitingMessageIdByRequestId(
        payload.providerRequestId,
      );
    }
    // MSG91 doesn't say its report `requestId` equals the send response's request id (plan note
    // 17): last resort, the latest message to that number still waiting for its WAMID, sent within
    // STATUS_MATCH_WINDOW_MS of the report.
    if (!messageLog && payload.providerMessageId && payload.recipientPhone) {
      messageLog = await this.messageLogStore.findAwaitingMessageIdByAddress(
        payload.recipientPhone,
        new Date(new Date(payload.timestamp).getTime() - STATUS_MATCH_WINDOW_MS),
      );
    }
    if (messageLog && !messageLog.providerMessageId && payload.providerMessageId) {
      await this.messageLogStore.update(messageLog.id, {
        providerMessageId: payload.providerMessageId,
      });
      messageLog = { ...messageLog, providerMessageId: payload.providerMessageId };
    }
    // Statuses for messages we don't know (older systems, other senders) are expected — ignore (L17).
    if (!messageLog) return 'unknown_message';

    // MSG91 posts sent / delivered / read close together and the worker runs jobs in parallel:
    // one status per row at a time, planned on the row as it is now, so a late `sent` can't
    // overwrite `read`. Busy → retried by BullMQ.
    const lockKey = `${STATUS_LOCK_PREFIX}${messageLog.id}`;
    const lockToken = await this.senderLock.acquire(lockKey);
    if (!lockToken) throw new SenderBusyError(lockKey);
    try {
      const current =
        (messageLog.providerMessageId &&
          (await this.messageLogStore.findByProviderMessageId(messageLog.providerMessageId))) ||
        messageLog;
      const patch = planStatusUpdate(current, {
        status: payload.status,
        timestamp: new Date(payload.timestamp),
        error: payload.error,
      });
      if (!patch) return 'unchanged';
      await this.messageLogStore.update(current.id, patch);
      for (const listener of this.statusListeners) {
        // A listener problem must not fail (and retry) the status itself.
        await listener.onStatusApplied(current, patch).catch((error: unknown) => {
          this.logger.warn(
            `[messaging] status listener failed for message_log ${current.id}: ${String(error)}`,
          );
        });
      }
      return 'applied';
    } finally {
      await this.senderLock.release(lockKey, lockToken);
    }
  }

  /** One bad message must not block the sender's queue: a handler failure becomes needs_review. */
  private async handleSafely(inbound: WhatsappInboundEntity): Promise<InboundResolutionPatch> {
    try {
      const result = await this.handler.handle(inbound);
      if (result.resolution === 'pending') {
        return {
          ...result,
          resolution: 'needs_review',
          resolutionNote: 'handler left the message pending',
        };
      }
      return result;
    } catch (handlerError) {
      const reason = handlerError instanceof Error ? handlerError.message : String(handlerError);
      this.logger.warn(`[messaging] inbound ${inbound.id} failed in the handler: ${reason}`);
      return { resolution: 'needs_review', resolutionNote: `handler error: ${reason}` };
    }
  }
}

function toStatusPayload(event: NormalizedStatus): ApplyStatusJobPayload {
  return {
    provider: event.provider,
    providerMessageId: event.providerMessageId,
    providerRequestId: event.providerRequestId,
    recipientPhone: event.recipientPhone,
    status: event.status,
    timestamp: event.timestamp.toISOString(),
    error: event.error,
  };
}

/** Until the reply router (Part 3) is wired, messages are stored and marked ignored, not lost. */
export const routerNotWiredHandler: InboundMessageHandler = {
  async handle() {
    return {
      resolution: 'ignored',
      resolutionNote: 'reply router not wired yet (messaging part 3)',
    };
  },
};
