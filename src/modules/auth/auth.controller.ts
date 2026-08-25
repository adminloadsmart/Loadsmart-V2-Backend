import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { AuthService } from './auth.service';

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  signup = async (req: Request, res: Response) => {
    const tokens = await this.authService.signup(req.body);
    respond(res, tokens, 201);
  };

  requestLoginOtp = async (req: Request, res: Response) => {
    const result = await this.authService.requestLoginOtp(req.body);
    respond(res, result, 200);
  };

  verifyOtp = async (req: Request, res: Response) => {
    const { phoneNumber } = req.signupPayload!;
    const tokens = await this.authService.verifyOtp({
      phoneNumber,
      otp: req.body.otp,
    });
    respond(res, tokens);
  };

  verifyLoginOtp = async (req: Request, res: Response) => {
    const { phoneNumber, portal } = req.loginPayload!;
    const tokens = await this.authService.verifyLoginOtp({
      phoneNumber,
      otp: req.body.otp,
      portal,
    });
    respond(res, tokens);
  };

  login = async (req: Request, res: Response) => {
    const user = await this.authService.login(req.body, req.ip ?? null);
    respond(res, user);
  };

  createPassword = async (req: Request, res: Response) => {
    const result = await this.authService.createPassword(req.user!, req.body);
    respond(res, result);
  };

  saveUserDetails = async (req: Request, res: Response) => {
    const result = await this.authService.saveUserDetails(req.user!, req.body);
    respond(res, result);
  };

  me = async (req: Request, res: Response) => {
    const profile = await this.authService.getProfile(req.user!.id);
    respond(res, profile);
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
}
