/** Why naming the driver was refused, carried on the error's `details.reason` — so a WhatsApp
 *  reply can tell the transporter / broker exactly what to fix instead of "we couldn't record". */
export const NAME_DRIVER_REFUSALS = {
  /** The truck is on another active load. */
  vehicleInUse: 'vehicle_in_use',
  /** The load has no truck yet and none came with the driver. */
  vehicleMissing: 'vehicle_missing',
} as const;
