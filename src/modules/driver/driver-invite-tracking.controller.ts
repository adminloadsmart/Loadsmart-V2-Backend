import { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { DriverService } from './driver.service';
import { InviteLinkParams } from './drivers.interface';

function matchesWebhookToken(token: unknown): boolean {
  if (!env.msg91WebhookToken || typeof token !== 'string') return false;
  const expected = Buffer.from(env.msg91WebhookToken);
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Public (no login) endpoints behind the driver invite's WhatsApp — see the routes file. */
export class DriverInviteTrackingController {
  constructor(private readonly driverService: DriverService) {}

  /** The tracked app link in the message: records the tap, then redirects to the app. */
  openInviteLink = async (req: Request<InviteLinkParams>, res: Response) => {
    const appUrl = await this.driverService.recordInviteLinkOpened(
      req.params.token,
      req.get('user-agent') ?? null,
    );
    if (appUrl) res.redirect(302, appUrl);
    else res.status(404).send('The driver app link is not set up yet.');
  };

  /** MSG91's WhatsApp delivery reports (delivered/read/failed). */
  whatsappReport = async (req: Request, res: Response) => {
    if (!matchesWebhookToken(req.query.token)) {
      console.warn('MSG91 WhatsApp webhook rejected — missing or wrong token');
      res.status(401).json({ success: false });
      return;
    }
    // The payload shape isn't verified yet (see adapters/msg91-whatsapp-report.ts) — logged in
    // full so the parser can be checked against a real report.
    console.info(`MSG91 WhatsApp webhook payload: ${JSON.stringify(req.body)}`);
    const applied = await this.driverService.recordWhatsAppReports(req.body);
    console.info(`MSG91 WhatsApp webhook: ${applied} driver invite report(s) applied`);
    // Always 200 once authenticated — a non-2xx makes MSG91 retry reports we've already seen.
    res.status(200).json({ success: true });
  };
}
