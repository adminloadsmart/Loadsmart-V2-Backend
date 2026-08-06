import { randomUUID } from 'crypto';
import { RequestHandler } from 'express';

export const requestId: RequestHandler = (req, res, next) => {
  req.id = req.header('X-Request-Id') ?? randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};
