import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { DriverAuthService } from './driver-auth.service';

// Mirrors modules/auth/auth.controller.ts's shape — see docs/driver-auth.md for why this is a
// separate identity domain rather than another endpoint on AuthController.
export class DriverAuthController {
  constructor(private readonly driverAuthService: DriverAuthService) {}

  requestOtp = async (req: Request, res: Response) => {
    const result = await this.driverAuthService.requestOtp(req.body);
    respond(res, result, 200);
  };

  verifyOtp = async (req: Request, res: Response) => {
    const { phoneNumber, candidates } = req.driverLoginPayload!;
    const result = await this.driverAuthService.verifyOtp({
      phoneNumber,
      candidates,
      otp: req.body.otp,
      fcmToken: req.body.fcmToken,
      deviceType: req.body.deviceType,
      deviceInfo: req.body.deviceInfo,
      ipAddress: req.ip ?? null,
    });
    respond(res, result);
  };

  selectTenant = async (req: Request, res: Response) => {
    const { candidates } = req.driverTenantSelectPayload!;
    const result = await this.driverAuthService.selectTenant({
      candidates,
      tenantId: req.body.tenantId,
      fcmToken: req.body.fcmToken,
      deviceType: req.body.deviceType,
      deviceInfo: req.body.deviceInfo,
      ipAddress: req.ip ?? null,
    });
    respond(res, result);
  };

  refresh = async (req: Request, res: Response) => {
    const result = await this.driverAuthService.refresh(req.body);
    respond(res, result);
  };

  // No body needed — sid/jti/exp all come from the caller's own verified driver access token.
  logout = async (req: Request, res: Response) => {
    await this.driverAuthService.logout({
      sid: req.driver!.sid,
      jti: req.driver!.jti,
      exp: req.driver!.exp,
    });
    respond(res, { success: true });
  };

  updateDeviceToken = async (req: Request, res: Response) => {
    await this.driverAuthService.updateDeviceToken(
      req.driver!.sid!,
      req.body.fcmToken,
      req.body.deviceType,
    );
    respond(res, { success: true });
  };
}
