import { NotFoundError } from '../../../shared/errors';
import { MessageLogEntity } from '../entities/message-log.entity';
import { WhatsappInboundEntity } from '../entities/whatsapp-inbound.entity';
import { MessageRecipientKind } from '../messaging.types';
import { LOADSMART_DISPLAY_NAME, SHIPPER_VISIBLE_RECIPIENT_KINDS } from '../messaging.constants';

/** The load facts the views need (tenant check; Loadsmart loads hide their brokers). */
export interface SentLogLoadLookup {
  findLoad(
    loadId: string,
    tenantId?: string,
  ): Promise<{ id: string; tenantId: string; route: string | null } | null>;
}

export interface SentLogStore {
  listMessagesForLoad(loadId: string, tenantId?: string): Promise<MessageLogEntity[]>;
  listRepliesForLoad(loadId: string): Promise<WhatsappInboundEntity[]>;
}

/** A row as the shipper sees it: no provider, ids, phone numbers or Loadsmart's brokers. */
export interface ShipperMessageView {
  recipient: string;
  recipientKind: MessageRecipientKind;
  channel: MessageLogEntity['channel'];
  message: string;
  status: MessageLogEntity['status'];
  at: string;
}

function messageTextOf(row: MessageLogEntity): string {
  return row.renderedText ?? (row.templateKey ? `Template: ${row.templateKey}` : '');
}

/** Read side of the load's message log (tasks 3 and 4). */
export class MessageLogQueryService {
  constructor(
    private readonly store: SentLogStore,
    private readonly loads: SentLogLoadLookup,
  ) {}

  /** GET /v1/loads/loads/:loadId/messages — shipper-safe. */
  async shipperView(tenantId: string, loadId: string): Promise<ShipperMessageView[]> {
    const load = await this.loads.findLoad(loadId, tenantId);
    if (!load) throw new NotFoundError(`Load ${loadId} not found`);
    const isLoadsmartLoad = load.route === 'loadsmart';
    const rows = await this.store.listMessagesForLoad(loadId, tenantId);
    return rows
      .filter((row) => SHIPPER_VISIBLE_RECIPIENT_KINDS.includes(row.recipientKind))
      .filter((row) => !(isLoadsmartLoad && row.recipientKind === 'transporter'))
      .map((row) => ({
        recipient:
          row.recipientKind === 'transporter' && isLoadsmartLoad
            ? LOADSMART_DISPLAY_NAME
            : (row.recipientName ?? row.recipientKind),
        recipientKind: row.recipientKind,
        channel: row.channel,
        message: messageTextOf(row),
        status: row.status,
        at: (row.sentAt ?? row.createdAt).toISOString(),
      }));
  }

  /** GET /v1/loadsmart-ops/loads/:loadId/messages — everything, for Loadsmart's teams. */
  async adminView(loadId: string) {
    if (!(await this.loads.findLoad(loadId))) throw new NotFoundError(`Load ${loadId} not found`);
    const rows = await this.store.listMessagesForLoad(loadId);
    return rows.map((row) => ({
      id: row.id,
      recipientKind: row.recipientKind,
      recipientRefId: row.recipientRefId,
      recipientName: row.recipientName,
      address: row.address,
      channel: row.channel,
      provider: row.provider,
      templateKey: row.templateKey,
      message: messageTextOf(row),
      intent: row.intent,
      status: row.status,
      suppressedReason: row.suppressedReason,
      actor: row.actor,
      createdAt: row.createdAt.toISOString(),
      sentAt: row.sentAt?.toISOString() ?? null,
    }));
  }

  /** GET /v1/loadsmart-ops/loads/:loadId/whatsapp — each WhatsApp message with its template,
   *  status times and the replies to it (task 4); replies matched to no message are listed apart. */
  async whatsappView(loadId: string) {
    if (!(await this.loads.findLoad(loadId))) throw new NotFoundError(`Load ${loadId} not found`);
    const [rows, replies] = await Promise.all([
      this.store.listMessagesForLoad(loadId),
      this.store.listRepliesForLoad(loadId),
    ]);
    const whatsappRows = rows.filter((row) => row.channel === 'whatsapp');
    const replyView = (reply: WhatsappInboundEntity) => ({
      id: reply.id,
      from: reply.fromPhone,
      type: reply.type,
      text: reply.body ?? reply.buttonText ?? reply.listRowId ?? null,
      buttonId: reply.buttonId,
      receivedAt: reply.receivedAt.toISOString(),
      routingMethod: reply.routingMethod,
      resolution: reply.resolution,
      resolutionNote: reply.resolutionNote,
      parsedValues: reply.parsedValues,
    });
    const messageIds = new Set(whatsappRows.map((row) => row.id));
    return {
      messages: whatsappRows.map((row) => ({
        id: row.id,
        recipientKind: row.recipientKind,
        recipientName: row.recipientName,
        address: row.address,
        kind: row.kind,
        template: row.templateKey,
        message: messageTextOf(row),
        status: row.status,
        suppressedReason: row.suppressedReason,
        providerMessageId: row.providerMessageId,
        createdAt: row.createdAt.toISOString(),
        sentAt: row.sentAt?.toISOString() ?? null,
        deliveredAt: row.deliveredAt?.toISOString() ?? null,
        readAt: row.readAt?.toISOString() ?? null,
        failedAt: row.failedAt?.toISOString() ?? null,
        error: row.error,
        replies: replies.filter((reply) => reply.matchedMessageLogId === row.id).map(replyView),
      })),
      otherReplies: replies
        .filter((reply) => !reply.matchedMessageLogId || !messageIds.has(reply.matchedMessageLogId))
        .map(replyView),
    };
  }
}
