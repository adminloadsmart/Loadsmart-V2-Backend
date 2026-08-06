import { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncController<Req extends Request = Request> = (req: Req, res: Response, next: NextFunction) => Promise<unknown>;

export const asyncHandler = <Req extends Request = Request>(controller: AsyncController<Req>): RequestHandler => {
  return (req, res, next) => {
    controller(req as Req, res, next).catch(next);
  };
};
