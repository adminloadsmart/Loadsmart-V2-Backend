import { Request, Response } from 'express';
import { DriverService } from './driver.service';
import { InviteLinkParams } from './drivers.interface';

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
}
