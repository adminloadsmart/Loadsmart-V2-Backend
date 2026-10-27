import { AppError } from '../../shared/errors/AppError';
import { DRIVER_JOIN_REQUEST_RESTORE_DAYS } from './driver.constants';
import { DriverErrorCode } from './drivers.types';
import { DriverErrorDefinition } from './drivers.interface';

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
