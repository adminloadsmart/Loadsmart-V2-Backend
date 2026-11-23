import { TruckBodyType } from '../truck-type/truck-type.types';
import {
  PickerBody,
  PickerWheel,
  pickerTruckTypeName,
  TRUCK_TYPE_PICKER_ROWS,
} from '../vehicle/truck-type-picker.constants';
import { AXLE_TYPE_WHEEL_COUNTS, VehicleAxleType } from '../vehicle/vehicle.type';

export interface TruckTypeCatalogConfiguration {
  name: string;
  bodyType: TruckBodyType;
  wheelConfiguration: number;
  capacityTons: number;
  /** The client list's "Body Type" label, e.g. "LCV Open Body" or "Multi Axle". */
  family: string;
  /** The picker's own step values, so a catalog row maps back to an exact pick. */
  body: PickerBody;
  wheel: PickerWheel;
  bodyLengthFt: string;
}

const BODY_FAMILY_LABELS: Partial<Record<TruckBodyType, string>> = {
  open_body: 'Open Body',
  lcv_open_body: 'LCV Open Body',
  container: 'Container Body',
  lcv_container: 'LCV Container Body',
};

/** 32 ft containers are named by their axle in the client's list, not by body. */
const AXLE_FAMILY_LABELS: Record<VehicleAxleType, string> = {
  sxl: 'Single Axle',
  sxl_hc_9_5: 'Single Axle 9.5 ft HC',
  sxl_hc_10: 'Single Axle 10 ft HC',
  mxl: 'Multi Axle',
  txl: 'Triple Axle',
};

/**
 * The global `masters.truck_type_catalog` contents: one entry per picker combination
 * (body → tyres/axle → tonnes → feet) in TRUCK_TYPE_PICKER_ROWS — the client's truck-type list.
 * Derived, not hand-written, so the catalog and the picker can never drift apart, and each name is
 * exactly what TruckTypeService.findOrCreateFromPicker saves a tenant row under.
 */
export const TRUCK_TYPE_CATALOG_CONFIGURATIONS: readonly TruckTypeCatalogConfiguration[] =
  TRUCK_TYPE_PICKER_ROWS.flatMap((row) =>
    row.bodyLengthsFt.map((bodyLengthFt) => ({
      name: pickerTruckTypeName(row, bodyLengthFt),
      bodyType: row.family,
      wheelConfiguration:
        typeof row.wheel === 'number' ? row.wheel : AXLE_TYPE_WHEEL_COUNTS[row.wheel],
      capacityTons: row.capacityTons,
      family:
        typeof row.wheel === 'number'
          ? (BODY_FAMILY_LABELS[row.family] ?? row.family)
          : AXLE_FAMILY_LABELS[row.wheel],
      body: row.body,
      wheel: row.wheel,
      bodyLengthFt,
    })),
  );

/** Every name the catalog (and a tenant's truck types) may carry. */
export const TRUCK_TYPE_CATALOG_NAMES: readonly string[] = TRUCK_TYPE_CATALOG_CONFIGURATIONS.map(
  (config) => config.name,
);
