import { PaginationInput } from '../../shared/utils/pagination';
import { NotificationChannelName } from './notifications.types';

/** Destination the caller supplies for each requested channel — this module owns no
 *  contact/token registry of its own, so these are taken as-is (see notifications.service.ts). */
export interface NotificationDestinations {
  email?: string;
  phoneNumber?: string;
  pushToken?: string;
}

/**
 * The shape NotificationsService.send() takes. There is no HTTP endpoint for this — it's called
 * in-process by other modules once wired (nothing calls it yet in this change), so this is a
 * plain TS interface, not a zod-validated request body.
 */
export interface CreateNotificationInput {
  recipientUserId: string;
  type: string;
  title: string;
  body: string;
  channels?: NotificationChannelName[];
  destinations?: NotificationDestinations;
  metadata?: Record<string, unknown> | null;
}

export interface ListNotificationsInput extends PaginationInput {
  unreadOnly?: boolean;
}
