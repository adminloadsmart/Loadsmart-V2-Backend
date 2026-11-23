import { toIndianMsisdn } from '../../../shared/utils/phone-number';
import { WhatsappInboundEntity } from '../entities/whatsapp-inbound.entity';
import { MessageLogEntity } from '../entities/message-log.entity';
import {
  ASKS_FOR_VARIABLE,
  LAST_ASK_WINDOW_MS,
  LOAD_PICK_TTL_MS,
  STAGES_ACCEPTING_VALUE,
  TAPPED_MESSAGE_WAIT,
  UNREADABLE_REPLIED_TYPES,
  VALUE_ASKED_BY_PROMPT,
  VALUE_ASKED_BY_TEMPLATE,
  WHATSAPP_INTERACTIVE_LIMITS,
} from '../messaging.constants';
import { OfferAction, RecipientLoadStage, ReplyValueKind, RoutingMethod } from '../messaging.types';
import { actionOfButtonTitle, isTemplateKey } from '../templates/template-registry';
import { NormalizedMedia } from '../providers/whatsapp-provider.interface';
import { InboundMessageHandler, InboundRetry } from '../inbound/inbound-pipeline.service';
import { InboundResolutionPatch } from '../repositories/whatsapp-inbound.repository';
import {
  DispatchDetails,
  bareLoadCodeOf,
  classifyTypedReply,
  decodeLoadRowId,
  decodeOfferButtonId,
  loadCodesIn,
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

/** The value a message of ours asked for: a question (rate / driver details / slip) or a
 *  confirmation marked with one ("Done. Send the truck number…"). Offers are not asks. */
function askedValueOf(messageLog: MessageLogEntity): ReplyValueKind | null {
  if (messageLog.templateKey && messageLog.templateKey in VALUE_ASKED_BY_TEMPLATE) {
    return VALUE_ASKED_BY_TEMPLATE[messageLog.templateKey as keyof typeof VALUE_ASKED_BY_TEMPLATE];
  }
  if (messageLog.kind === 'info') {
    const asked = messageLog.variables?.[ASKS_FOR_VARIABLE];
    return typeof asked === 'string' ? (asked as ReplyValueKind) : null;
  }
  return messageLog.kind && messageLog.kind in VALUE_ASKED_BY_PROMPT
    ? VALUE_ASKED_BY_PROMPT[messageLog.kind as keyof typeof VALUE_ASKED_BY_PROMPT]
    : null;
}

/** Whether this ask was about this candidate load. A template ask (LS_N_0121) names the
 *  transporter by its own id while the candidate carries its load_recipients id, so templates match
 *  on the load — the asks are already only those sent to this phone. */
function asksCandidate(ask: MessageLogEntity, candidate: OpenRecipientLoad): boolean {
  if (ask.templateKey && ask.templateKey in VALUE_ASKED_BY_TEMPLATE) {
    return ask.loadId !== null && ask.loadId === candidate.loadId;
  }
  return ask.loadRef === candidate.loadRef && ask.recipientRefId === candidate.recipientRefId;
}

/**
 * The reply router — the mapping logic proven live on 13 Nov (R1–R12, 0 values on the wrong user):
 * 1. context.id → the message_log row we sent → recipient + load (taps, list picks, swipes, attachments).
 *    Every reply we send about a load is logged on it, so a swipe on any of them names the load;
 * 2. our button / row id cross-checks step 1 (disagreement → needs_review);
 * 3. a load code typed in the text ("LOAD-0042 42000") → that open load of the sender;
 * 4. no context → the sender's only load waiting for this kind of value;
 * 5. several waiting → the one we asked for this value in the last LAST_ASK_WINDOW_MS (offers
 *    are not asks); never a guess between two asked loads;
 * 6. still several → a "Load chunein" list (only the asked loads, if any were asked); the value
 *    waits on the inbound row until the pick — a list row or the typed load code;
 * 7. anything else (incl. Flow replies, not handled yet) → needs_review. Business writes go through ReplyActions, sends through ReplySender.
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

  async handle(inbound: WhatsappInboundEntity): Promise<InboundResolutionPatch | InboundRetry> {
    const senderIdentity: SenderIdentity = { phone: inbound.fromPhone, userId: inbound.fromUserId };
    switch (inbound.type) {
      case 'button':
        return this.routeOfferTap(inbound, senderIdentity);
      case 'list_pick':
        return this.routeLoadPick(inbound, senderIdentity);
      case 'flow_reply':
        // Stored with its response_json; WhatsApp Flows are not in today's scope.
        await this.sender.sendInfo(senderIdentity, REPLY_TEXTS.teamWillCheck(null), inbound.id);
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
        // A voice note, location… is answered; a reaction or a system event is not.
        if ((UNREADABLE_REPLIED_TYPES as readonly string[]).includes(inbound.providerType)) {
          await this.sender.sendInfo(senderIdentity, REPLY_TEXTS.textAndPhotosOnly, inbound.id);
        }
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
  ): Promise<InboundResolutionPatch | InboundRetry> {
    const buttonId = decodeOfferButtonId(inbound.buttonId);
    const answeredMessage = await this.findAnsweredMessage(inbound);
    // A template quick reply carries only its text: without the tapped message there is no load
    // and no action. Its WAMID may simply not be in yet — wait for it rather than drop the tap.
    const tappedMessageUnknown = !answeredMessage && !!inbound.contextMessageId && !buttonId;
    if (tappedMessageUnknown) {
      const retry = this.waitForTappedMessage(inbound);
      if (retry) return retry;
    }
    if (answeredMessage && !this.isSameSender(answeredMessage, senderIdentity)) {
      await this.sender.sendInfo(senderIdentity, REPLY_TEXTS.notYourLoadMessage, inbound.id);
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
        await this.sender.sendInfo(
          senderIdentity,
          REPLY_TEXTS.teamWillCheck(context.loadRef),
          inbound.id,
          { context },
        );
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
    if (!context) {
      if (!tappedMessageUnknown) {
        await this.sender.sendInfo(senderIdentity, REPLY_TEXTS.notYourLoadMessage, inbound.id);
        return this.needsReview('tap could not be matched to one of our offers');
      }
      // Reached once: the row leaves 'pending' with this result, so no later run sends it again.
      await this.sender.sendInfo(senderIdentity, REPLY_TEXTS.tapNotMatched, inbound.id);
      return this.needsReview(
        `tapped message ${inbound.contextMessageId} still unknown after ${TAPPED_MESSAGE_WAIT.windowMs / 60_000} min`,
      );
    }
    if (!action) {
      // e.g. "Sent by courier" / "Bringing it" (LS_N_0115 / 0116): the team follows it up.
      await this.sender.sendInfo(
        senderIdentity,
        REPLY_TEXTS.teamWillCheck(context.loadRef),
        inbound.id,
        { context },
      );
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
        await this.sender.sendInfo(
          senderIdentity,
          REPLY_TEXTS.alreadyNoted(context.loadRef, inbound.buttonText ?? action),
          inbound.id,
          { context },
        );
        return { ...evidenceFor(context, routingMethod), resolution: 'repeat_tap' };
      }
      if (firstAction) {
        await this.sender.sendInfo(
          senderIdentity,
          REPLY_TEXTS.firstAnswerKept(context.loadRef, firstAction),
          inbound.id,
          { context },
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
    const typedPick = bareLoadCodeOf(sourceText);
    if (typedPick) {
      const picked = await this.routeTypedPick(inbound, senderIdentity, typedPick);
      if (picked) return picked;
    }
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
    return this.routeValue(inbound, senderIdentity, value, sourceText, loadCodesIn(sourceText));
  }

  private async routeValue(
    inbound: WhatsappInboundEntity,
    senderIdentity: SenderIdentity,
    value: ReplyValue,
    sourceText: string,
    typedLoadCodes: string[] = [],
  ): Promise<InboundResolutionPatch> {
    const answeredMessage = await this.findAnsweredMessage(inbound);
    if (answeredMessage) {
      if (!this.isSameSender(answeredMessage, senderIdentity)) {
        await this.sender.sendInfo(senderIdentity, REPLY_TEXTS.notYourLoadMessage, inbound.id);
        return this.needsReview("reply points at another user's message");
      }
      const context = contextFromMessageLog(answeredMessage);
      // A quoted message without a load (e.g. a plain info text) falls through to the pending loads.
      if (context)
        return this.applyValueToLoad(context, value, inbound, senderIdentity, 'context_id');
    }

    if (typedLoadCodes.length > 0) {
      const named = await this.routeByTypedLoadCode(
        inbound,
        senderIdentity,
        value,
        sourceText,
        typedLoadCodes,
      );
      if (named) return named;
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

    // Several wait: the load(s) we asked for this value lately. One → it; several → list only those.
    const asked = await this.recentlyAskedLoads(senderIdentity, value.kind, candidates);
    if (asked.length === 1) {
      return this.applyValueToLoad(toContext(asked[0]), value, inbound, senderIdentity, 'last_ask');
    }
    return this.sendPicker(
      inbound,
      senderIdentity,
      value,
      sourceText,
      asked.length ? asked : candidates,
    );
  }

  /** "LOAD-0042 42000": the load the sender named. Null when the code names none of their open
   *  loads (the usual rules then decide — the text may carry an old code). */
  private async routeByTypedLoadCode(
    inbound: WhatsappInboundEntity,
    senderIdentity: SenderIdentity,
    value: ReplyValue,
    sourceText: string,
    typedLoadCodes: string[],
  ): Promise<InboundResolutionPatch | null> {
    const openLoads = await this.actions.findOpenLoadsForSender(senderIdentity);
    const named = openLoads.filter((load) => typedLoadCodes.includes(load.loadRef.toUpperCase()));
    if (named.length === 0) return null;
    if (named.length === 1) {
      return this.applyValueToLoad(
        toContext(named[0]),
        value,
        inbound,
        senderIdentity,
        'load_code',
      );
    }
    // Two codes in one message, or one load reached through two of the sender's records.
    return this.sendPicker(inbound, senderIdentity, value, sourceText, named);
  }

  /** The candidates we asked for this kind of value within LAST_ASK_WINDOW_MS. */
  private async recentlyAskedLoads(
    senderIdentity: SenderIdentity,
    kind: ReplyValueKind,
    candidates: OpenRecipientLoad[],
  ): Promise<OpenRecipientLoad[]> {
    const since = new Date(this.now().getTime() - LAST_ASK_WINDOW_MS);
    const asks = (await this.store.findRecentLoadMessagesTo(senderIdentity.phone, since)).filter(
      (log) => askedValueOf(log) === kind,
    );
    return candidates.filter((candidate) => asks.some((log) => asksCandidate(log, candidate)));
  }

  private async sendPicker(
    inbound: WhatsappInboundEntity,
    senderIdentity: SenderIdentity,
    value: ReplyValue,
    sourceText: string,
    candidates: OpenRecipientLoad[],
  ): Promise<InboundResolutionPatch> {
    const listedLoads = candidates.slice(0, WHATSAPP_INTERACTIVE_LIMITS.listRowsMax);
    const pickerMessageLogId = await this.sender.sendLoadPicker(
      senderIdentity,
      listedLoads,
      REPLY_TEXTS.pickerPrompt(value.kind, sourceText),
      inbound.id,
    );
    if (!pickerMessageLogId) {
      await this.sender.sendInfo(senderIdentity, REPLY_TEXTS.teamWillCheck(null), inbound.id);
      return this.needsReview('several loads fit but the "Load chunein" list could not be sent');
    }
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
  ): Promise<InboundResolutionPatch | InboundRetry> {
    const pickerMessage = await this.findAnsweredMessage(inbound);
    if (!pickerMessage && inbound.contextMessageId) {
      // Same race as a template tap: the list's WAMID may not be in yet.
      const retry = this.waitForTappedMessage(inbound);
      if (retry) return retry;
      await this.sender.sendInfo(senderIdentity, REPLY_TEXTS.tapNotMatched, inbound.id);
      return this.needsReview(
        `picked list ${inbound.contextMessageId} still unknown after ${TAPPED_MESSAGE_WAIT.windowMs / 60_000} min`,
      );
    }
    if (!pickerMessage || pickerMessage.kind !== 'picker') {
      await this.sender.sendInfo(senderIdentity, REPLY_TEXTS.pickerExpired, inbound.id);
      return this.needsReview('list pick does not answer one of our "Load chunein" lists');
    }
    if (!this.isSameSender(pickerMessage, senderIdentity)) {
      await this.sender.sendInfo(senderIdentity, REPLY_TEXTS.notYourLoadMessage, inbound.id);
      return this.needsReview("list pick points at another user's list");
    }

    const waitingMessage = await this.store.findAwaitingPick(pickerMessage.id);
    if (!waitingMessage) {
      await this.sender.sendInfo(senderIdentity, REPLY_TEXTS.pickerAlreadyAnswered, inbound.id);
      return this.needsReview('nothing is waiting on this list (already picked or expired)');
    }
    return this.applyPick(
      inbound,
      senderIdentity,
      waitingMessage,
      pickerMessage.id,
      decodeLoadRowId(inbound.listRowId),
      inbound.listRowId,
    );
  }

  /** A load code typed instead of tapping the open "Which load?" list. Null when no list of this
   *  sender is open (the code is then read as part of a value). */
  private async routeTypedPick(
    inbound: WhatsappInboundEntity,
    senderIdentity: SenderIdentity,
    typedLoadRef: string,
  ): Promise<InboundResolutionPatch | null> {
    const since = new Date(this.now().getTime() - LOAD_PICK_TTL_MS);
    const waitingMessage = await this.store.findLatestAwaitingPickFrom(senderIdentity.phone, since);
    if (!waitingMessage?.pickerMessageLogId) return null;
    const offered = (waitingMessage.parsedValues?.candidates ?? []) as RecipientLoadContext[];
    const match = offered.find((candidate) => candidate.loadRef.toUpperCase() === typedLoadRef);
    return this.applyPick(
      inbound,
      senderIdentity,
      waitingMessage,
      waitingMessage.pickerMessageLogId,
      match?.loadRef ?? typedLoadRef,
      typedLoadRef,
    );
  }

  private async applyPick(
    inbound: WhatsappInboundEntity,
    senderIdentity: SenderIdentity,
    waitingMessage: WhatsappInboundEntity,
    pickerMessageLogId: string,
    pickedLoadRef: string | null,
    pickedLabel: string | null,
  ): Promise<InboundResolutionPatch> {
    const offeredCandidates = (waitingMessage.parsedValues?.candidates ??
      []) as RecipientLoadContext[];
    const chosenContext = offeredCandidates.find(
      (candidate) => candidate.loadRef === pickedLoadRef,
    );
    if (!chosenContext) {
      await this.sender.sendInfo(senderIdentity, REPLY_TEXTS.pickerExpired, inbound.id);
      return this.needsReview(`picked ${pickedLabel} was not in the list`);
    }

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
      pickerMessageLogId,
    });
    return {
      ...result,
      matchedMessageLogId: pickerMessageLogId,
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
      const reason = (await this.actions.whyNotAccepted?.(context, value.kind)) ?? null;
      await this.sender.sendInfo(
        senderIdentity,
        reason ?? REPLY_TEXTS.wrongStage(context.loadRef),
        valueMessage.id,
        { context },
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
        { context, asksFor: 'dispatch' },
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
    // Logged on the load (with what it asks for next), so a swipe on it routes back here. An
    // outcome with neither a reply nor a next question still gets a closing reply.
    const closingText =
      outcome.confirmationText ??
      (outcome.nextPrompt
        ? null
        : outcome.resolution === 'needs_review'
          ? REPLY_TEXTS.teamWillCheck(context.loadRef)
          : REPLY_TEXTS.noted(context.loadRef));
    if (closingText)
      await this.sender.sendInfo(senderIdentity, closingText, replyToInboundId, {
        context,
        asksFor: outcome.asksFor ?? null,
      });
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

  /** Wait again while the tap is younger than TAPPED_MESSAGE_WAIT.windowMs (from when we stored
   *  it, not MSG91's time — MSG91 may hand us the tap late too); null once the wait is over. */
  private waitForTappedMessage(inbound: WhatsappInboundEntity): InboundRetry | null {
    const waitedMs = this.now().getTime() - new Date(inbound.createdAt).getTime();
    if (!(waitedMs < TAPPED_MESSAGE_WAIT.windowMs)) return null;
    return {
      retryAfterMs: TAPPED_MESSAGE_WAIT.retryMs,
      note: `waiting for message ${inbound.contextMessageId} to be known`,
    };
  }

  private isSameSender(messageLog: MessageLogEntity, senderIdentity: SenderIdentity): boolean {
    return toIndianMsisdn(messageLog.address) === toIndianMsisdn(senderIdentity.phone);
  }

  private needsReview(note: string): InboundResolutionPatch {
    return { resolution: 'needs_review', resolutionNote: note, routingMethod: 'none' };
  }
}
