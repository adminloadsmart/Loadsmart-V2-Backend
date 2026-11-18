import {
  DispatchMessage,
  DispatchOffer,
  DispatchResult,
  LoadDispatchNotifier,
} from '../../loads/load-posting/load-dispatch-notifier';
import { MessageStatus } from '../../loads/load-posting/utils/load-posting.types';
import { OutboundMessageService, OutboundResult } from '../outbound/outbound-message.service';
import { TemplateKey } from '../templates/template-registry';
import { formatReportingTime, formatRupees } from './offer-formatting';
import { MESSAGING_ACTORS, SHIPPER_NAME_FALLBACK } from '../messaging.constants';

/** Used when the shipper's company has no name on file yet. */

type OfferSender = Pick<OutboundMessageService, 'sendOffer'>;

/** The shipper company's name, shown to its own transporters ("New load from {{shipper_name}}").
 *  Transporters on own routes see it: the shipper is their customer (catalog copy rules). */
export interface ShipperNameLookup {
  nameOf(tenantId: string): Promise<string | null>;
}

/** Which catalog template a posting goes out as (load-flow notifications): a market post with a
 *  price → LS_N_0119 (Accept / Negotiate / Reject); asking for quotes → its variant LS_N_0119_QUOTE
 *  (Give rate / Reject); an indent → LS_N_0120 (Accept / Reject at the contract rate). Own fleet
 *  goes to no transporter. */
export function offerTemplateFor(
  offer: DispatchOffer,
): { templateKey: TemplateKey; priceVariable: 'price' | 'rate' | null } | null {
  if (offer.mode === 'indent') return { templateKey: 'LS_N_0120', priceVariable: 'rate' };
  if (offer.mode !== 'market_fleet') return null;
  if (offer.priceMode === 'set_target' && offer.rate)
    return { templateKey: 'LS_N_0119', priceVariable: 'price' };
  return { templateKey: 'LS_N_0119_QUOTE', priceVariable: null };
}

/**
 * Posts a load to the shipper's transporters on WhatsApp: one offer per load (so each reply names
 * one load). Every send is logged in message_log first, then queued — so a recipient is `pending`
 * here, never `sent`; a suppressed send (template not approved, no phone…) is `failed`. Never
 * throws for a delivery problem (LoadDispatchNotifier contract).
 */
export class WhatsappDispatchNotifier implements LoadDispatchNotifier {
  constructor(
    private readonly outbound: OfferSender,
    private readonly shipperNames: ShipperNameLookup,
  ) {}

  async send(message: DispatchMessage): Promise<DispatchResult[]> {
    const offer = message.offer;
    const template = offer ? offerTemplateFor(offer) : null;
    const shipperName =
      offer && template
        ? ((await this.shipperNames.nameOf(message.tenantId).catch(() => null)) ??
          SHIPPER_NAME_FALLBACK)
        : SHIPPER_NAME_FALLBACK;
    return Promise.all(
      message.recipients.map(async (recipient): Promise<DispatchResult> => {
        // Loadsmart is reached through the ops console, not WhatsApp.
        if (recipient.type !== 'transporter')
          return { recipientId: recipient.recipientId, status: 'pending' };
        if (!recipient.phone || !offer || !template)
          return { recipientId: recipient.recipientId, status: 'failed' };
        const statuses: MessageStatus[] = [];
        for (const load of offer.loads) {
          statuses.push(await this.sendOne(message, offer, template, shipperName, recipient, load));
        }
        return {
          recipientId: recipient.recipientId,
          status: statuses.every((status) => status === 'failed') ? 'failed' : 'pending',
        };
      }),
    );
  }

  private async sendOne(
    message: DispatchMessage,
    offer: DispatchOffer,
    template: NonNullable<ReturnType<typeof offerTemplateFor>>,
    shipperName: string,
    recipient: DispatchMessage['recipients'][number],
    load: DispatchOffer['loads'][number],
  ): Promise<MessageStatus> {
    const reportingTime = formatReportingTime(offer.pickupAt);
    const variables: Record<string, string> = {
      shipper_name: shipperName,
      origin: offer.pickupLabel,
      destination: offer.dropLabel,
      truck_type: offer.truckLabel,
      reporting_time: reportingTime,
    };
    if (template.priceVariable && offer.rate)
      variables[template.priceVariable] = formatRupees(offer.rate);
    const priceText = template.priceVariable && offer.rate ? ` · ₹${formatRupees(offer.rate)}` : '';
    try {
      const result: OutboundResult = await this.outbound.sendOffer({
        tenantId: message.tenantId,
        loadId: load.loadId,
        loadRef: load.loadCode,
        recipient: {
          kind: 'transporter',
          refId: recipient.recipientId,
          name: recipient.name,
          phone: recipient.phone!,
        },
        templateKey: template.templateKey,
        variables,
        actor: MESSAGING_ACTORS.loadPosting,
        sessionBodyText: `New load from ${shipperName}: ${offer.pickupLabel} to ${offer.dropLabel}, ${offer.truckLabel}, reporting ${reportingTime}${priceText}`,
      });
      return result.status === 'queued' ? 'pending' : 'failed';
    } catch (error) {
      console.error(
        `[messaging] offer ${load.loadCode} to recipient ${recipient.recipientId} failed`,
        error,
      );
      return 'failed';
    }
  }
}
