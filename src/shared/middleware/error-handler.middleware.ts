import { ErrorRequestHandler } from 'express';
import { AppError } from '../errors';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    if (!err.isOperational) {
      console.error(err);
    }

    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        // `isOperational` already distinguishes "expected error, details are safe to show" from
        // "unexpected failure" — InternalError sets it false and its `details` is whatever raw
        // error rethrow() caught (a TypeORM QueryFailedError carries the literal failing SQL and
        // its bound parameters as own properties), which must never reach the client.
        ...(err.isOperational ? { details: err.details } : {}),
      },
    });
    return;
  }

  console.error(err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
  });
};
