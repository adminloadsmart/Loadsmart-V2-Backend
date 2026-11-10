import { DRIVER_POD_REMINDER_NOTIFICATION_TYPE } from '../../driver/driver.constants';
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
    {
      type: DRIVER_POD_REMINDER_NOTIFICATION_TYPE,
      params: { loadId: load.id, loadCode: load.code, vehicleNumber: load.vehicleNumber ?? null },
    },
    { loadId: load.id },
  );
  return 'sent';
}
