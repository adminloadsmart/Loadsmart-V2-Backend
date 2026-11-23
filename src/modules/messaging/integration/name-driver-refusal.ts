import { AppError } from '../../../shared/errors/AppError';
import { NAME_DRIVER_REFUSALS } from '../../loads/memo/load-memo.constants';
import { NameDriverRefusalDetails } from '../../loads/utils/load-memo.interface';
import { REPLY_TEXTS } from '../router/reply-texts';

/**
 * The reply for a truck / driver the load refused for a reason the sender can fix (the error's
 * `details.reason`, NAME_DRIVER_REFUSALS): the truck is on another active trip, or no truck came.
 * null for any other error — those keep the general "Our team will call you".
 */
export function nameDriverRefusalText(error: AppError, loadRef: string): string | null {
  const details = error.details as Partial<NameDriverRefusalDetails> | null | undefined;
  if (!details || typeof details !== 'object') return null;
  if (details.reason === NAME_DRIVER_REFUSALS.vehicleInUse) {
    return REPLY_TEXTS.truckInUse(loadRef, details.vehicleNumber ?? 'this truck');
  }
  if (details.reason === NAME_DRIVER_REFUSALS.vehicleMissing) {
    return REPLY_TEXTS.truckMissing(loadRef);
  }
  return null;
}
