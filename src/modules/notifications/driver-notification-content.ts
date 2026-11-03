import { formatDate } from '../../shared/i18n/format';
import { Locale } from '../../shared/i18n/locales';
import { t } from '../../shared/i18n/translate';
import { DRIVER_MESSAGE_PARAMS_KEY } from './notifications.constants';
import {
  DriverLoadAssignedMessageParams,
  DriverMessage,
  DriverMessageRenderers,
  DriverMessageText,
} from './notifications.types';

function loadAssignedText(
  params: DriverLoadAssignedMessageParams,
  locale: Locale,
): DriverMessageText {
  let message: string;
  if (params.loadCount !== 1 || !params.loadCode) {
    message = t(locale, 'driverNotifications.loadAssigned.bodyMany', { count: params.loadCount });
  } else {
    const route = params.from && params.to ? `${params.from} → ${params.to}` : null;
    const pickupAt = params.pickupAt
      ? formatDate(params.pickupAt, locale, {
          day: 'numeric',
          month: 'short',
          hour: 'numeric',
          minute: '2-digit',
        })
      : params.pickupDate;
    const details = [
      route,
      pickupAt ? t(locale, 'driverNotifications.loadAssigned.pickup', { pickupAt }) : null,
      params.vehicleNumber
        ? t(locale, 'driverNotifications.loadAssigned.truck', {
            vehicleNumber: params.vehicleNumber,
          })
        : null,
    ].filter(Boolean);
    message = details.length
      ? t(locale, 'driverNotifications.loadAssigned.bodyWithDetails', {
          loadCode: params.loadCode,
          details: details.join(' · '),
        })
      : t(locale, 'driverNotifications.loadAssigned.body', { loadCode: params.loadCode });
  }

  const body = params.fleetOwnerPhone
    ? t(locale, 'driverNotifications.loadAssigned.withFleetOwner', {
        message,
        fleetOwner: t(locale, 'driverNotifications.loadAssigned.fleetOwner', {
          name:
            params.fleetOwnerName ??
            t(locale, 'driverNotifications.loadAssigned.fleetOwnerFallbackName'),
          phoneNumber: params.fleetOwnerPhone,
        }),
      })
    : message;
  return { title: t(locale, 'driverNotifications.loadAssigned.title'), body };
}

const RENDERERS: DriverMessageRenderers = {
  'driver.account.invited': (params, locale) => ({
    title: t(locale, 'driverNotifications.invited.title'),
    body: t(locale, 'driverNotifications.invited.body', { ...params }),
  }),
  'driver.account.join_approved': (params, locale) => ({
    title: t(locale, 'driverNotifications.joinApproved.title'),
    body: t(locale, 'driverNotifications.joinApproved.body', { ...params }),
  }),
  'driver.account.join_rejected': (params, locale) => ({
    title: t(locale, 'driverNotifications.joinRejected.title'),
    body: t(locale, 'driverNotifications.joinRejected.body', { ...params }),
  }),
  'driver.trip.pod_reminder': (params, locale) => ({
    title: t(locale, 'driverNotifications.podReminder.title'),
    body: params.vehicleNumber
      ? t(locale, 'driverNotifications.podReminder.bodyWithVehicle', {
          loadCode: params.loadCode,
          vehicleNumber: params.vehicleNumber,
        })
      : t(locale, 'driverNotifications.podReminder.body', { loadCode: params.loadCode }),
  }),
  'load.assigned': loadAssignedText,
  'load.loading_contact_changed': (params, locale) => ({
    title: t(locale, 'driverNotifications.loadingContactChanged.title'),
    body: t(locale, 'driverNotifications.loadingContactChanged.body', { ...params }),
  }),
  'load.loading_point_changed': (params, locale) => ({
    title: t(locale, 'driverNotifications.loadingPointChanged.title'),
    body: t(locale, 'driverNotifications.loadingPointChanged.body', { ...params }),
  }),
};

/** A driver notification's title/body in `locale` — for push (the device session's language)
 *  and for the in-app list (the request's Accept-Language). */
export function renderDriverMessage(message: DriverMessage, locale: Locale): DriverMessageText {
  const render = RENDERERS[message.type] as (
    params: DriverMessage['params'],
    locale: Locale,
  ) => DriverMessageText;
  return render(message.params, locale);
}

/** The stored notification re-rendered in `locale`, or null when it predates translation (no
 *  saved params) or isn't a driver message type — those keep their stored text. */
export function renderStoredDriverMessage(
  type: string,
  metadata: Record<string, unknown> | null,
  locale: Locale,
): DriverMessageText | null {
  const params = metadata?.[DRIVER_MESSAGE_PARAMS_KEY];
  if (!(type in RENDERERS) || !params || typeof params !== 'object') return null;
  return renderDriverMessage({ type, params } as DriverMessage, locale);
}
