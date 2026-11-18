import { toIndianMsisdn } from '../../../shared/utils/phone-number';
import { INDIAN_MOBILE_DIGITS } from '../messaging.constants';

/** The forms a stored Indian number may take for a WhatsApp number: the 10 digits (how users and
 *  drivers are stored) and 91 + the 10 digits (older rows). */
export function storedPhoneVariantsOf(phone: string): string[] {
  const national = toIndianMsisdn(phone).slice(-INDIAN_MOBILE_DIGITS);
  return [national, toIndianMsisdn(national)];
}
