import { NOTIFICATION_CATALOG } from '../catalog/notification-catalog';
import { NotificationEntity } from '../notifications.entity';
import { NotificationSeverity } from '../notifications.types';
import {
  DEFAULT_CTA_STYLE_BY_SEVERITY,
  NOTIFICATION_CATEGORY_LABELS,
  QUIET_HOURS_BYPASS_SEVERITY,
} from '../notifications.constants';
import {
  CatalogDisplayFields,
  NotificationCategoryChip,
  NotificationPresentation,
  PresentedNotification,
} from '../notifications.interface';

function catalogDisplayFieldsOf(type: string): CatalogDisplayFields | undefined {
  return (NOTIFICATION_CATALOG as Record<string, CatalogDisplayFields>)[type];
}

/** A type's inbox chip — 'general' for a type no longer in the catalog. */
export function categoryOf(type: string): NotificationCategoryChip {
  const category = catalogDisplayFieldsOf(type)?.category ?? 'general';
  return { category, categoryLabel: NOTIFICATION_CATEGORY_LABELS[category] };
}

/** Display-only fields derived from the type's catalog entry — computed on read, never stored,
 *  so rows created before these existed get them too. */
export function presentationOf(
  type: string,
  severity: NotificationSeverity,
): NotificationPresentation {
  return {
    ...categoryOf(type),
    ctaStyle: catalogDisplayFieldsOf(type)?.ctaStyle ?? DEFAULT_CTA_STYLE_BY_SEVERITY[severity],
    bypassesQuietHours: severity === QUIET_HOURS_BYPASS_SEVERITY,
  };
}

export function presentNotification(notification: NotificationEntity): PresentedNotification {
  return { ...notification, ...presentationOf(notification.type, notification.severity) };
}
