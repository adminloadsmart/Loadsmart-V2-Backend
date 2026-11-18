import { WhatsappInboundEntity } from '../entities/whatsapp-inbound.entity';
import { MessageRecipientKind, OfferAction, RecipientLoadStage } from '../messaging.types';
import { DispatchDetails } from '../parsers/reply-value.parsers';
import { NormalizedMedia } from '../providers/whatsapp-provider.interface';
import {
  ActionOutcome,
  OpenRecipientLoad,
  RecipientLoadContext,
  ReplyActions,
  SenderIdentity,
} from '../router/reply-router.ports';

/**
 * One ReplyActions over several recipient kinds (shipper's transporters, Loadsmart partners…): a
 * phone's open loads are the union across kinds (one person may be both — finding G3); every
 * other call goes to the actions for the context's recipient kind.
 */
export class CompositeReplyActions implements ReplyActions {
  constructor(private readonly byKind: Partial<Record<MessageRecipientKind, ReplyActions>>) {}

  async findOpenLoadsForSender(sender: SenderIdentity): Promise<OpenRecipientLoad[]> {
    const lists = await Promise.all(
      Object.values(this.byKind).map((actions) => actions!.findOpenLoadsForSender(sender)),
    );
    return lists.flat();
  }

  async stageOf(context: RecipientLoadContext): Promise<RecipientLoadStage> {
    return this.byKind[context.recipientKind]?.stageOf(context) ?? 'closed';
  }

  applyOfferAction(
    context: RecipientLoadContext,
    action: OfferAction,
    inbound: WhatsappInboundEntity,
  ): Promise<ActionOutcome> {
    return this.for(context).applyOfferAction(context, action, inbound);
  }

  applyRate(
    context: RecipientLoadContext,
    rate: number,
    truckNumber: string | null,
    inbound: WhatsappInboundEntity,
  ): Promise<ActionOutcome> {
    return this.for(context).applyRate(context, rate, truckNumber, inbound);
  }

  applyTruck(
    context: RecipientLoadContext,
    truckNumber: string,
    inbound: WhatsappInboundEntity,
  ): Promise<ActionOutcome> {
    return this.for(context).applyTruck(context, truckNumber, inbound);
  }

  applyDispatch(
    context: RecipientLoadContext,
    details: DispatchDetails,
    inbound: WhatsappInboundEntity,
  ): Promise<ActionOutcome> {
    return this.for(context).applyDispatch(context, details, inbound);
  }

  applySlip(
    context: RecipientLoadContext,
    media: NormalizedMedia,
    inbound: WhatsappInboundEntity,
  ): Promise<ActionOutcome> {
    return this.for(context).applySlip(context, media, inbound);
  }

  private for(context: RecipientLoadContext): ReplyActions {
    const actions = this.byKind[context.recipientKind];
    if (!actions) throw new Error(`no reply actions for recipient kind "${context.recipientKind}"`);
    return actions;
  }
}
