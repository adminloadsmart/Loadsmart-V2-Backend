import { WhatsappInboundEntity } from '../entities/whatsapp-inbound.entity';
import { MessageLogEntity } from '../entities/message-log.entity';
import {
  InboundResolution,
  MessageRecipientKind,
  OfferAction,
  RecipientLoadStage,
  ReplyPrompt,
} from '../messaging.types';
import { NormalizedMedia } from '../providers/whatsapp-provider.interface';
import { DispatchDetails } from '../parsers/reply-value.parsers';
import { InboundResolutionPatch } from '../repositories/whatsapp-inbound.repository';

/** One recipient on one load — what every routed reply resolves to. */
export interface RecipientLoadContext {
  tenantId: string | null;
  loadId: string | null;
  loadRef: string;
  recipientKind: MessageRecipientKind;
  recipientRefId: string;
  /** The message_log row the reply answered, when it came through context.id. */
  messageLogId: string | null;
}

export interface OpenRecipientLoad extends RecipientLoadContext {
  stage: RecipientLoadStage;
  /** Short lane text for the "Load chunein" list row (≤ 72 chars), never the shipper's name. */
  laneLabel: string;
}

export interface SenderIdentity {
  phone: string;
  userId: string | null;
}

export interface ActionOutcome {
  resolution: InboundResolution;
  note?: string;
  /** Question to ask next (rate / truck+driver / loading slip). */
  nextPrompt?: ReplyPrompt;
  /** Short confirmation for the user, e.g. "₹45,000 LS-2004 ke liye record hua". */
  confirmationText?: string;
}

/**
 * Business side (Part 5): reads stages and writes bids / acceptances / truck+driver / slips
 * through the existing load services. The router never touches load tables itself.
 */
export interface ReplyActions {
  /** Loads this sender (all of their partner / transporter records) can still answer. */
  findOpenLoadsForSender(sender: SenderIdentity): Promise<OpenRecipientLoad[]>;
  stageOf(context: RecipientLoadContext): Promise<RecipientLoadStage>;
  applyOfferAction(
    context: RecipientLoadContext,
    action: OfferAction,
    inbound: WhatsappInboundEntity,
  ): Promise<ActionOutcome>;
  /** A rate, with the truck number when it came in the same message. */
  applyRate(
    context: RecipientLoadContext,
    rate: number,
    truckNumber: string | null,
    inbound: WhatsappInboundEntity,
  ): Promise<ActionOutcome>;
  /** The truck number on its own, after Accept or a rate ("Send the truck number if you have it"). */
  applyTruck(
    context: RecipientLoadContext,
    truckNumber: string,
    inbound: WhatsappInboundEntity,
  ): Promise<ActionOutcome>;
  applyDispatch(
    context: RecipientLoadContext,
    details: DispatchDetails,
    inbound: WhatsappInboundEntity,
  ): Promise<ActionOutcome>;
  applySlip(
    context: RecipientLoadContext,
    media: NormalizedMedia,
    inbound: WhatsappInboundEntity,
  ): Promise<ActionOutcome>;
}

/** Outbound side (Part 4): every send is logged in message_log so its replies route back. */
export interface ReplySender {
  sendInfo(sender: SenderIdentity, text: string, replyToInboundId: string): Promise<void>;
  sendPrompt(
    context: RecipientLoadContext,
    sender: SenderIdentity,
    prompt: ReplyPrompt,
    replyToInboundId: string,
  ): Promise<void>;
  /** Sends a "Load chunein" list; returns the picker's message_log id (null if it could not be sent). */
  sendLoadPicker(
    sender: SenderIdentity,
    candidates: OpenRecipientLoad[],
    promptText: string,
    replyToInboundId: string,
  ): Promise<string | null>;
}

/** The router's reads/writes on the messaging tables. */
export interface RouterMessageStore {
  findMessageLogByProviderMessageId(providerMessageId: string): Promise<MessageLogEntity | null>;
  findMessageLogById(messageLogId: string): Promise<MessageLogEntity | null>;
  /** The inbound row waiting on this picker (resolution awaiting_load_pick). */
  findAwaitingPick(pickerMessageLogId: string): Promise<WhatsappInboundEntity | null>;
  /** The first decisive tap already recorded on this message (for changed-answer / repeat). */
  findFirstDecision(
    messageLogId: string,
    excludeInboundId: string,
  ): Promise<WhatsappInboundEntity | null>;
  recordResolution(inboundId: string, patch: InboundResolutionPatch): Promise<void>;
}
