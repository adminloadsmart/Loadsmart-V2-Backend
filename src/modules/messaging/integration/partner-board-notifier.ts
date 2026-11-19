import { LoadBoardNotifier, LoadBoardOffer } from '../../loadsmart-ops/loadsmart.interface';
import { OutboundMessageService } from '../outbound/outbound-message.service';
import { formatReportingTime, formatRupees, formatTonnes } from './offer-formatting';
import { MESSAGING_ACTORS } from '../messaging.constants';

/**
 * Sends a load just posted on Loadsmart's board to the partners on its lane (`offer.partners`,
 * picked by lane-matching) on WhatsApp — catalog
 * LS_N_0105 with the partner rate (margin already out) and Accept / Negotiate / Reject, or
 * LS_N_0106 with Give rate / Reject when the shipper asked for quotes. Never throws.
 */
export class PartnerBoardNotifier implements LoadBoardNotifier {
  constructor(private readonly outbound: Pick<OutboundMessageService, 'sendOffer'>) {}

  async postedToBoard(offer: LoadBoardOffer): Promise<void> {
    try {
      const partners = offer.partners;
      if (!partners.length) return;
      const reportingTime = formatReportingTime(offer.pickupAt);
      // Catalog LS_N_0105 (rate given) / LS_N_0106 (asking for rates): area, pincode, city only —
      // never the shipper's name, full address or price (Loadsmart's margin is already out).
      const variables: Record<string, string> = {
        from_area: offer.pickupLabel,
        to_area: offer.dropLabel,
        truck_type: offer.truckLabel,
        weight: formatTonnes(offer.weightTonnes),
        reporting_time: reportingTime,
      };
      const templateKey = offer.partnerRate ? 'LS_N_0105' : 'LS_N_0106';
      if (offer.partnerRate) variables.rate = formatRupees(offer.partnerRate);
      const rateText = offer.partnerRate ? `. Rate ₹${variables.rate}` : '';
      for (const partner of partners) {
        await this.outbound
          .sendOffer({
            tenantId: offer.tenantId,
            loadId: offer.loadId,
            loadRef: offer.loadCode,
            recipient: {
              kind: 'partner',
              refId: partner.id,
              name: partner.name,
              phone: partner.phone,
            },
            templateKey,
            variables,
            actor: MESSAGING_ACTORS.loadBoard,
            sessionBodyText: `New load from Loadsmart: ${offer.pickupLabel} to ${offer.dropLabel}, ${offer.truckLabel}, ${variables.weight} t, reporting ${reportingTime}${rateText}`,
          })
          .catch((error: unknown) =>
            console.error(
              `[messaging] board offer ${offer.loadCode} to partner ${partner.id} failed`,
              error,
            ),
          );
      }
    } catch (error) {
      console.error(`[messaging] could not send board load ${offer.loadCode} to partners`, error);
    }
  }
}
