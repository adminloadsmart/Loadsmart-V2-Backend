import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { AuthService } from './auth.service';

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  signup = async (req: Request, res: Response) => {
    const tokens = await this.authService.signup(req.body);
    respond(res, tokens, 201);
  };

  verifyOtp = async (req: Request, res: Response) => {
    const { phoneNumber } = req.signupPayload!;
    const tokens = await this.authService.verifyOtp({ phoneNumber, otp: req.body.otp });
    respond(res, tokens);
  };

  login = async (req: Request, res: Response) => {
    const user = await this.authService.login(req.body, req.ip ?? null);
    respond(res, user);
  };

  refresh = async (req: Request, res: Response) => {
    const tokens = await this.authService.refresh(req.body);
    respond(res, tokens);
  };

  logout = async (req: Request, res: Response) => {
    await this.authService.logout({
      ...req.body,
      userId: req.user!.id,
      jti: req.user!.jti,
      exp: req.user!.exp,
    });
    respond(res, { success: true });
  };

  deleteAccount = async (req: Request, res: Response) => {
    await this.authService.deleteAccount(req.user!);
    respond(res, { success: true });
  };

  getOrganization = async (req: Request, res: Response) => {
    if (!req.user!.tenantId) {
      respond(res, null); // hasn't completed their company profile yet — no organization exists
      return;
    }
    const organization = await this.authService.getOrganization(req.user!.tenantId);
    respond(res, organization);
  };

  createOrganization = async (req: Request, res: Response) => {
    const result = await this.authService.createOrganization(
      req.user!.id,
      req.user!.tenantId,
      req.body,
    );
    respond(res, result);
  };
}
