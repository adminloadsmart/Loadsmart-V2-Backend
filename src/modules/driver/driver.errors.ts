import { AppError } from '../../shared/errors/AppError';
import { DRIVER_JOIN_REQUEST_RESTORE_DAYS } from './driver.constants';

/** Codes the frontend can tell these driver failures apart by (`error.code`). */
export type DriverErrorCode =
  | 'DRIVER_NOT_FOUND'
  | 'REQUEST_NOT_FOUND'
  | 'NOT_REJECTED'
  | 'RESTORE_WINDOW_EXPIRED'
  | 'DRIVER_UNAVAILABLE';

/** How one code is sent: its HTTP status, and the message shown to the user as-is (Title Case to
 *  match the UI). */
interface DriverErrorDefinition {
  statusCode: 404 | 409;
  message: string;
}

const DRIVER_ERRORS: Record<DriverErrorCode, DriverErrorDefinition> = {
  // Invite by mobile number — only a number that already belongs to a driver can be invited.
  DRIVER_NOT_FOUND: {
    statusCode: 404,
    message: 'No Driver Is Registered with this Number. Add Them Under Add a Driver First.',
  },
  // Restore a rejected join request.
  REQUEST_NOT_FOUND: { statusCode: 404, message: 'This Request No Longer Exists.' },
  NOT_REJECTED: {
    statusCode: 409,
    message: "This Request Isn't Rejected, So It Can't Be Restored.",
  },
  RESTORE_WINDOW_EXPIRED: {
    statusCode: 409,
    message: `This Request Was Rejected Over ${DRIVER_JOIN_REQUEST_RESTORE_DAYS} Days Ago and Can't Be Restored.`,
  },
  DRIVER_UNAVAILABLE: {
    statusCode: 409,
    message: 'This Driver Is No Longer Available to Join Your Fleet.',
  },
};

/**
 * A driver action that can't go ahead, with its own `code` — the shared NotFoundError and
 * ConflictError always send NOT_FOUND / CONFLICT.
 */
export class DriverError extends AppError {
  constructor(code: DriverErrorCode) {
    const { statusCode, message } = DRIVER_ERRORS[code];
    super(message, statusCode, code);
  }
}
