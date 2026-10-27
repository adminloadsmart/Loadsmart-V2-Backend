import { LoadRepository } from '../load.repository';
import { PodReminderJobPayload, DriverTripNotifier } from '../utils/load-alert.interface';

/** Runs one queued E-POD reminder: sent only while the truck is still at the unloading point with
 *  no E-POD — once the POD is in (or the load moved on), the remaining reminders do nothing. */
export async function processPodReminder(
  payload: PodReminderJobPayload,
  loadRepository: Pick<LoadRepository, 'findById'>,
  notifier: DriverTripNotifier,
): Promise<'sent' | 'skipped'> {
  const load = await loadRepository.findById(payload.tenantId, payload.loadId);
  if (!load || load.status !== 'reached_unloading' || load.podFileKey || !load.driverId) {
    return 'skipped';
  }
  await notifier.notifyTripReminder(
    load.tenantId,
    load.driverId,
    'driver.trip.pod_reminder',
    'Upload the E-POD',
    `Load ${load.code}${load.vehicleNumber ? ` (${load.vehicleNumber})` : ''} is at the unloading point. Upload the POD front and back once unloading is done.`,
  );
  return 'sent';
}
