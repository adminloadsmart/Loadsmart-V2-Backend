import { toIndianMsisdn } from '../../../shared/utils/phone-number';
import { WhatsappInboundEntity } from '../entities/whatsapp-inbound.entity';
import { MessageLogEntity } from '../entities/message-log.entity';
import {
  LOAD_PICK_TTL_MS,
  STAGES_ACCEPTING_VALUE,
  WHATSAPP_INTERACTIVE_LIMITS,
} from '../messaging.constants';
import { OfferAction, RecipientLoadStage, ReplyValueKind, RoutingMethod } from '../messaging.types';
import { actionOfButtonTitle, isTemplateKey } from '../templates/template-registry';
import { NormalizedMedia } from '../providers/whatsapp-provider.interface';
import { InboundMessageHandler } from '../inbound/inbound-pipeline.service';
import { InboundResolutionPatch } from '../repositories/whatsapp-inbound.repository';
import {
  DispatchDetails,
  classifyTypedReply,
  decodeLoadRowId,
  decodeOfferButtonId,
} from '../parsers/reply-value.parsers';
import { REPLY_TEXTS } from './reply-texts';
import {
  ActionOutcome,
  OpenRecipientLoad,
  RecipientLoadContext,
  ReplyActions,
  ReplySender,
  RouterMessageStore,
  SenderIdentity,
} from './reply-router.ports';

export type ReplyValue =
  | { kind: 'rate'; rate: number; truckNumber?: string | null }
  | { kind: 'truck'; truckNumber: string }
  | { kind: 'dispatch'; dispatch: DispatchDetails }
  | { kind: 'slip'; media: NormalizedMedia };

export interface ReplyRouterConfig {
  now?: () => Date;
}

/** The offer action of a tap: our own session-button id first, else the tapped template's button
 *  with that text (MSG91 returns a template quick reply as `{payload, text}`, not our id). */
function tapActionOf(
  tap: Pick<WhatsappInboundEntity, 'buttonId' | 'buttonText'>,
  decodedButtonId: ReturnType<typeof decodeOfferButtonId>,
  answeredMessage: MessageLogEntity | null,
): OfferAction | null {
  if (decodedButtonId) return decodedButtonId.action;
  const templateKey = answeredMessage?.templateKey;
  if (!isTemplateKey(templateKey)) return null;
  return (
    actionOfButtonTitle(templateKey, tap.buttonText) ??
    actionOfButtonTitle(templateKey, tap.buttonId)
  );
}

/** Fields stored on whatsapp_inbound as the evidence of which load / recipient a reply hit. */
function evidenceFor(
  context: RecipientLoadContext,
  routingMethod: RoutingMethod,
): InboundResolutionPatch {
  return {
    resolution: 'pending',
    routingMethod,
    matchedMessageLogId: context.messageLogId,
    loadId: context.loadId,
    loadRef: context.loadRef,
    recipientRefId: context.recipientRefId,
  };
}

function contextFromMessageLog(messageLog: MessageLogEntity): RecipientLoadContext | null {
  if (!messageLog.loadRef || !messageLog.recipientRefId) return null;
  return {
    tenantId: messageLog.tenantId,
    loadId: messageLog.loadId,
    loadRef: messageLog.loadRef,
    recipientKind: messageLog.recipientKind,
    recipientRefId: messageLog.recipientRefId,
    messageLogId: messageLog.id,
  };
}

/** Keep only the context fields (stored on the waiting inbound row for a load pick). */
function toContext(load: OpenRecipientLoad): RecipientLoadContext {
  const { tenantId, loadId, loadRef, recipientKind, recipientRefId, messageLogId } = load;
  return { tenantId, loadId, loadRef, recipientKind, recipientRefId, messageLogId };
}

const acceptsValue = (stage: RecipientLoadStage, kind: ReplyValueKind): boolean =>
  (STAGES_ACCEPTING_VALUE[kind] as readonly RecipientLoadStage[]).includes(stage);

/**
 * The reply router — the mapping logic proven live on 13 Nov (R1–R12, 0 values on the wrong user):
 * 1. context.id → the message_log row we sent → recipient + load (taps, list picks, swipes, attachments);
 * 2. our button / row id cross-checks step 1 (disagreement → needs_review);
 * 3. no context → the sender's only load waiting for this kind of value;
 * 4. several waiting → a "Load chunein" list; the value waits on the inbound row until the pick;
 * 5. anything else (incl. Flow replies, not handled yet) → needs_review. Business writes go through ReplyActions, sends through ReplySender.
 */
export class WhatsappReplyRouter implements InboundMessageHandler {
  private readonly now: () => Date;

  constructor(
    private readonly store: RouterMessageStore,
    private readonly actions: ReplyActions,
    private readonly sender: ReplySender,
    private readonly config: ReplyRouterConfig,
  ) {
    this.now = config.now ?? (() => new Date());
  }

  async handle(inbound: WhatsappInboundEntity): Promise<InboundResolutionPatch> {
    const senderIdentity: SenderIdentity = { phone: inbound.fromPhone, userId: inbound.fromUserId };
    switch (inbound.type) {
      case 'button':
        return this.routeOfferTap(inbound, senderIdentity);
      case 'list_pick':
        return this.routeLoadPick(inbound, senderIdentity);
      case 'flow_reply':
        // Stored with its response_json; WhatsApp Flows are not in today's scope.
        return this.needsReview('Flow replies are not handled yet');
      case 'image':
      case 'document':
        return this.routeValue(
          inbound,
          senderIdentity,
          { kind: 'slip', media: inbound.media as unknown as NormalizedMedia },
          inbound.type,
        );
      case 'text':
        return this.routeText(inbound, senderIdentity);
      default:
        return {
          resolution: 'ignored',
          resolutionNote: `unsupported message type "${inbound.providerType}"`,
        };
    }
  }

  // ---------------------------------------------------------------- offer taps

  private async routeOfferTap(
    inbound: WhatsappInboundEntity,
    senderIdentity: SenderIdentity,
  ): Promise<InboundResolutionPatch> {
    const buttonId = decodeOfferButtonId(inbound.buttonId);
    const answeredMessage = await this.findAnsweredMessage(inbound);
    if (answeredMessage && !this.isSameSender(answeredMessage, senderIdentity)) {
      return this.needsReview("tap points at another user's message");
    }
    // Our session buttons carry `action:loadRef:recipientRef`; an MSG91 template quick reply
    // carries only its text, read against the tapped message's template.
    const action = tapActionOf(inbound, buttonId, answeredMessage);

    let context: RecipientLoadContext | null = null;
    let routingMethod: RoutingMethod = 'none';
    if (answeredMessage) {
      context = contextFromMessageLog(answeredMessage);
      routingMethod = 'context_id';
      if (
        context &&
        buttonId &&
        (buttonId.loadRef !== context.loadRef || buttonId.recipientRef !== context.recipientRefId)
      ) {
        return {
          ...evidenceFor(context, routingMethod),
          resolution: 'needs_review',
          resolutionNote: `button id ${inbound.buttonId} disagrees with the message it answers`,
        };
      }
    } else if (buttonId) {
      const openLoads = await this.actions.findOpenLoadsForSender(senderIdentity);
      const matchedLoad = openLoads.find(
        (load) =>
          load.loadRef === buttonId.loadRef && load.recipientRefId === buttonId.recipientRef,
      );
      if (matchedLoad) {
        context = toContext(matchedLoad);
        routingMethod = 'button_id';
      }
    }
    if (!context) return this.needsReview('tap could not be matched to one of our offers');
    if (!action) {
      return {
        ...evidenceFor(context, routingMethod),
        resolution: 'needs_review',
        resolutionNote: `button "${inbound.buttonText ?? inbound.buttonId}" is not handled on WhatsApp yet`,
      };
    }

    if (context.messageLogId) {
      const firstDecision = await this.store.findFirstDecision(context.messageLogId, inbound.id);
      const firstAction = firstDecision
        ? tapActionOf(firstDecision, decodeOfferButtonId(firstDecision.buttonId), answeredMessage)
        : null;
      if (firstAction === action) {
        return { ...evidenceFor(context, routingMethod), resolution: 'repeat_tap' };
      }
      if (firstAction) {
        await this.sender.sendInfo(
          senderIdentity,
          REPLY_TEXTS.firstAnswerKept(context.loadRef, firstAction),
          inbound.id,
        );
        return {
          ...evidenceFor(context, routingMethod),
          resolution: 'changed_answer',
          resolutionNote: `first "${firstAction}", then "${action}"`,
        };
      }
    }

    const outcome = await this.actions.applyOfferAction(context, action, inbound);
    return this.finish(outcome, context, senderIdentity, inbound.id, routingMethod);
  }

  // ---------------------------------------------------------------- typed values, attachments

  private async routeText(
    inbound: WhatsappInboundEntity,
    senderIdentity: SenderIdentity,
  ): Promise<InboundResolutionPatch> {
    const sourceText = inbound.body ?? '';
    const classified = classifyTypedReply(sourceText);
    if (classified.kind === null) {
      await this.sender.sendInfo(senderIdentity, REPLY_TEXTS.notUnderstood, inbound.id);
      return this.needsReview('text not understood');
    }
    const value: ReplyValue =
      classified.kind === 'rate'
        ? { kind: 'rate', rate: classified.rate, truckNumber: classified.truckNumber }
        : classified.kind === 'truck'
          ? { kind: 'truck', truckNumber: classified.truckNumber }
          : { kind: 'dispatch', dispatch: classified.dispatch };
    return this.routeValue(inbound, senderIdentity, value, sourceText);
  }

  private async routeValue(
    inbound: WhatsappInboundEntity,
    senderIdentity: SenderIdentity,
    value: ReplyValue,
    sourceText: string,
  ): Promise<InboundResolutionPatch> {
    const answeredMessage = await this.findAnsweredMessage(inbound);
    if (answeredMessage) {
      if (!this.isSameSender(answeredMessage, senderIdentity))
        return this.needsReview("reply points at another user's message");
      const context = contextFromMessageLog(answeredMessage);
      // A quoted message without a load (e.g. a plain info text) falls through to the pending loads.
      if (context)
        return this.applyValueToLoad(context, value, inbound, senderIdentity, 'context_id');
    }

    const candidates = await this.waitingLoads(senderIdentity, value.kind);
    if (candidates.length === 0) {
      await this.sender.sendInfo(senderIdentity, REPLY_TEXTS.nothingWaiting, inbound.id);
      return this.needsReview(
        `${value.kind} received but no load of this sender is waiting for it`,
      );
    }
    if (candidates.length === 1) {
      return this.applyValueToLoad(
        toContext(candidates[0]),
        value,
        inbound,
        senderIdentity,
        'only_pending',
      );
    }

    const listedLoads = candidates.slice(0, WHATSAPP_INTERACTIVE_LIMITS.listRowsMax);
    const pickerMessageLogId = await this.sender.sendLoadPicker(
      senderIdentity,
      listedLoads,
      REPLY_TEXTS.pickerPrompt(value.kind, sourceText),
      inbound.id,
    );
    if (!pickerMessageLogId)
      return this.needsReview('several loads fit but the "Load chunein" list could not be sent');
    const overflowNote =
      candidates.length > listedLoads.length
        ? `${candidates.length} loads fit, list shows ${listedLoads.length}`
        : null;
    return {
      resolution: 'awaiting_load_pick',
      resolutionNote: overflowNote,
      routingMethod: 'none',
      pickerMessageLogId,
      parsedValues: { value, sourceText, candidates: listedLoads.map(toContext) },
    };
  }

  private async routeLoadPick(
    inbound: WhatsappInboundEntity,
    senderIdentity: SenderIdentity,
  ): Promise<InboundResolutionPatch> {
    const pickerMessage = await this.findAnsweredMessage(inbound);
    if (!pickerMessage || pickerMessage.kind !== 'picker')
      return this.needsReview('list pick does not answer one of our "Load chunein" lists');
    if (!this.isSameSender(pickerMessage, senderIdentity))
      return this.needsReview("list pick points at another user's list");

    const waitingMessage = await this.store.findAwaitingPick(pickerMessage.id);
    if (!waitingMessage)
      return this.needsReview('nothing is waiting on this list (already picked or expired)');

    const pickedLoadRef = decodeLoadRowId(inbound.listRowId);
    const offeredCandidates = (waitingMessage.parsedValues?.candidates ??
      []) as RecipientLoadContext[];
    const chosenContext = offeredCandidates.find(
      (candidate) => candidate.loadRef === pickedLoadRef,
    );
    if (!chosenContext)
      return this.needsReview(`picked row ${inbound.listRowId} was not in the list`);

    if (this.now().getTime() - waitingMessage.receivedAt.getTime() > LOAD_PICK_TTL_MS) {
      await this.store.recordResolution(waitingMessage.id, {
        resolution: 'needs_review',
        resolutionNote: 'load pick arrived after expiry',
      });
      await this.sender.sendInfo(senderIdentity, REPLY_TEXTS.pickerExpired, inbound.id);
      return this.needsReview('load pick after expiry');
    }

    const storedValue = waitingMessage.parsedValues?.value as ReplyValue;
    // The business write is evidenced by the message that carried the value, not the tap on the list.
    const result = await this.applyValueToLoad(
      chosenContext,
      storedValue,
      waitingMessage,
      senderIdentity,
      'load_picker',
    );
    await this.store.recordResolution(waitingMessage.id, {
      ...result,
      pickerMessageLogId: pickerMessage.id,
    });
    return {
      ...result,
      matchedMessageLogId: pickerMessage.id,
      resolutionNote: `load pick for inbound ${waitingMessage.id}`,
    };
  }

  // ---------------------------------------------------------------- shared steps

  private async applyValueToLoad(
    context: RecipientLoadContext,
    value: ReplyValue,
    valueMessage: WhatsappInboundEntity,
    senderIdentity: SenderIdentity,
    routingMethod: RoutingMethod,
  ): Promise<InboundResolutionPatch> {
    const evidence = { ...evidenceFor(context, routingMethod), parsedValues: { value } };
    const stage = await this.actions.stageOf(context);
    if (!acceptsValue(stage, value.kind)) {
      await this.sender.sendInfo(
        senderIdentity,
        REPLY_TEXTS.wrongStage(context.loadRef),
        valueMessage.id,
      );
      return {
        ...evidence,
        resolution: 'needs_review',
        resolutionNote: `${value.kind} for ${context.loadRef} while it is "${stage}"`,
      };
    }
    if (value.kind === 'dispatch' && !value.dispatch.isComplete) {
      await this.sender.sendInfo(
        senderIdentity,
        REPLY_TEXTS.incompleteDispatch(context.loadRef),
        valueMessage.id,
      );
      return {
        ...evidence,
        resolution: 'validation_failed',
        resolutionNote: 'truck / driver details incomplete — asked again',
      };
    }

    let outcome: ActionOutcome;
    if (value.kind === 'rate')
      outcome = await this.actions.applyRate(
        context,
        value.rate,
        value.truckNumber ?? null,
        valueMessage,
      );
    else if (value.kind === 'truck')
      outcome = await this.actions.applyTruck(context, value.truckNumber, valueMessage);
    else if (value.kind === 'dispatch')
      outcome = await this.actions.applyDispatch(context, value.dispatch, valueMessage);
    else outcome = await this.actions.applySlip(context, value.media, valueMessage);
    return {
      ...(await this.finish(outcome, context, senderIdentity, valueMessage.id, routingMethod)),
      parsedValues: { value },
    };
  }

  private async finish(
    outcome: ActionOutcome,
    context: RecipientLoadContext,
    senderIdentity: SenderIdentity,
    replyToInboundId: string,
    routingMethod: RoutingMethod,
  ): Promise<InboundResolutionPatch> {
    if (outcome.confirmationText)
      await this.sender.sendInfo(senderIdentity, outcome.confirmationText, replyToInboundId);
    if (outcome.nextPrompt)
      await this.sender.sendPrompt(context, senderIdentity, outcome.nextPrompt, replyToInboundId);
    return {
      ...evidenceFor(context, routingMethod),
      resolution: outcome.resolution,
      resolutionNote: outcome.note ?? null,
    };
  }

  private async waitingLoads(
    senderIdentity: SenderIdentity,
    kind: ReplyValueKind,
  ): Promise<OpenRecipientLoad[]> {
    const openLoads = await this.actions.findOpenLoadsForSender(senderIdentity);
    const accepting = openLoads.filter((load) => acceptsValue(load.stage, kind));
    if (kind !== 'rate') return accepting;
    // A rate goes first to loads that asked for one (Negotiate tapped); only otherwise to fresh offers.
    const askedForRate = accepting.filter((load) => load.stage === 'awaiting_rate');
    return askedForRate.length > 0 ? askedForRate : accepting;
  }

  private async findAnsweredMessage(
    inbound: WhatsappInboundEntity,
  ): Promise<MessageLogEntity | null> {
    return inbound.contextMessageId
      ? this.store.findMessageLogByProviderMessageId(inbound.contextMessageId)
      : null;
  }

  private isSameSender(messageLog: MessageLogEntity, senderIdentity: SenderIdentity): boolean {
    return toIndianMsisdn(messageLog.address) === toIndianMsisdn(senderIdentity.phone);
  }

  private needsReview(note: string): InboundResolutionPatch {
    return { resolution: 'needs_review', resolutionNote: note, routingMethod: 'none' };
  }
}
