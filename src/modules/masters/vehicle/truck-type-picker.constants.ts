import { TruckBodyType } from '../truck-type/truck-type.types';
import { VehicleAxleType } from './vehicle.type';

/** Step 1 of the Add Truck drawer's truck-type picker. */
export const PICKER_BODIES = ['open', 'closed'] as const;
export type PickerBody = (typeof PICKER_BODIES)[number];

/** Step 2 — a tyre count, or (32 ft containers only) an axle type. */
export type PickerWheel = number | VehicleAxleType;

export interface TruckTypePickerRow {
  /** The tenant truck_types body class this combination is saved under. */
  family: TruckBodyType;
  body: PickerBody;
  wheel: PickerWheel;
  capacityTons: number;
  bodyLengthsFt: readonly string[];
}

/**
 * Every combination the picker offers (body → tyres/axle → tonnes → feet), from the Add Truck
 * Drawer Redesign's ROWS table. The single source the onboard validator checks a pick against and
 * TruckTypeService.findOrCreateFromPicker names a truck type from. LCVs are up to 7.5 T.
 */
export const TRUCK_TYPE_PICKER_ROWS: readonly TruckTypePickerRow[] = [
  { family: 'lcv_open_body', body: 'open', wheel: 4, capacityTons: 1.5, bodyLengthsFt: ['8-10'] },
  { family: 'lcv_open_body', body: 'open', wheel: 4, capacityTons: 2, bodyLengthsFt: ['10-12'] },
  { family: 'lcv_open_body', body: 'open', wheel: 6, capacityTons: 3.5, bodyLengthsFt: ['14'] },
  { family: 'lcv_open_body', body: 'open', wheel: 6, capacityTons: 4, bodyLengthsFt: ['14', '17'] },
  { family: 'lcv_open_body', body: 'open', wheel: 6, capacityTons: 4.5, bodyLengthsFt: ['17'] },
  {
    family: 'lcv_open_body',
    body: 'open',
    wheel: 6,
    capacityTons: 6,
    bodyLengthsFt: ['17', '19', '20', '22', '24'],
  },
  { family: 'lcv_open_body', body: 'open', wheel: 6, capacityTons: 6.5, bodyLengthsFt: ['19'] },
  {
    family: 'lcv_open_body',
    body: 'open',
    wheel: 6,
    capacityTons: 7,
    bodyLengthsFt: ['19', '20', '22', '24'],
  },
  {
    family: 'lcv_open_body',
    body: 'open',
    wheel: 6,
    capacityTons: 7.5,
    bodyLengthsFt: ['20', '22', '24'],
  },
  { family: 'open_body', body: 'open', wheel: 6, capacityTons: 8, bodyLengthsFt: ['20', '22'] },
  { family: 'open_body', body: 'open', wheel: 6, capacityTons: 9, bodyLengthsFt: ['22', '24'] },
  {
    family: 'open_body',
    body: 'open',
    wheel: 6,
    capacityTons: 10,
    bodyLengthsFt: ['20', '22', '24'],
  },
  {
    family: 'open_body',
    body: 'open',
    wheel: 6,
    capacityTons: 12,
    bodyLengthsFt: ['20', '22', '24'],
  },
  { family: 'open_body', body: 'open', wheel: 10, capacityTons: 15, bodyLengthsFt: ['22'] },
  { family: 'open_body', body: 'open', wheel: 10, capacityTons: 16, bodyLengthsFt: ['22'] },
  { family: 'open_body', body: 'open', wheel: 10, capacityTons: 18, bodyLengthsFt: ['24'] },
  {
    family: 'open_body',
    body: 'open',
    wheel: 12,
    capacityTons: 25,
    bodyLengthsFt: ['24', '25', '26', '28'],
  },
  {
    family: 'open_body',
    body: 'open',
    wheel: 14,
    capacityTons: 30,
    bodyLengthsFt: ['28', '30', '32'],
  },
  { family: 'open_body', body: 'open', wheel: 16, capacityTons: 35, bodyLengthsFt: ['30', '32'] },
  { family: 'open_body', body: 'open', wheel: 18, capacityTons: 35, bodyLengthsFt: ['30'] },
  { family: 'open_body', body: 'open', wheel: 18, capacityTons: 42, bodyLengthsFt: ['32'] },

  { family: 'lcv_container', body: 'closed', wheel: 4, capacityTons: 1.5, bodyLengthsFt: ['8-10'] },
  { family: 'lcv_container', body: 'closed', wheel: 4, capacityTons: 2, bodyLengthsFt: ['10-12'] },
  { family: 'lcv_container', body: 'closed', wheel: 4, capacityTons: 3.5, bodyLengthsFt: ['14'] },
  {
    family: 'lcv_container',
    body: 'closed',
    wheel: 6,
    capacityTons: 4,
    bodyLengthsFt: ['14', '17'],
  },
  { family: 'lcv_container', body: 'closed', wheel: 6, capacityTons: 4.5, bodyLengthsFt: ['17'] },
  {
    family: 'lcv_container',
    body: 'closed',
    wheel: 6,
    capacityTons: 6,
    bodyLengthsFt: ['17', '19', '20', '22', '24'],
  },
  { family: 'lcv_container', body: 'closed', wheel: 6, capacityTons: 6.5, bodyLengthsFt: ['19'] },
  {
    family: 'lcv_container',
    body: 'closed',
    wheel: 6,
    capacityTons: 7,
    bodyLengthsFt: ['19', '20', '22', '24'],
  },
  {
    family: 'lcv_container',
    body: 'closed',
    wheel: 6,
    capacityTons: 7.5,
    bodyLengthsFt: ['20', '22', '24'],
  },
  { family: 'container', body: 'closed', wheel: 6, capacityTons: 8, bodyLengthsFt: ['20'] },
  {
    family: 'container',
    body: 'closed',
    wheel: 6,
    capacityTons: 9,
    bodyLengthsFt: ['22', '24', '34'],
  },
  {
    family: 'container',
    body: 'closed',
    wheel: 6,
    capacityTons: 10,
    bodyLengthsFt: ['20', '22', '24'],
  },
  {
    family: 'container',
    body: 'closed',
    wheel: 6,
    capacityTons: 12,
    bodyLengthsFt: ['20', '22', '24'],
  },
  { family: 'container', body: 'closed', wheel: 'sxl', capacityTons: 7, bodyLengthsFt: ['32'] },
  { family: 'container', body: 'closed', wheel: 'sxl', capacityTons: 7.5, bodyLengthsFt: ['32'] },
  { family: 'container', body: 'closed', wheel: 'sxl', capacityTons: 8.5, bodyLengthsFt: ['32'] },
  { family: 'container', body: 'closed', wheel: 'sxl', capacityTons: 9, bodyLengthsFt: ['32'] },
  {
    family: 'container',
    body: 'closed',
    wheel: 'sxl_hc_9_5',
    capacityTons: 9.5,
    bodyLengthsFt: ['32'],
  },
  {
    family: 'container',
    body: 'closed',
    wheel: 'sxl_hc_10',
    capacityTons: 9.5,
    bodyLengthsFt: ['32'],
  },
  { family: 'container', body: 'closed', wheel: 'mxl', capacityTons: 14.5, bodyLengthsFt: ['32'] },
  { family: 'container', body: 'closed', wheel: 'mxl', capacityTons: 15, bodyLengthsFt: ['32'] },
  { family: 'container', body: 'closed', wheel: 'mxl', capacityTons: 18, bodyLengthsFt: ['32'] },
  { family: 'container', body: 'closed', wheel: 'mxl', capacityTons: 24, bodyLengthsFt: ['32'] },
  { family: 'container', body: 'closed', wheel: 'txl', capacityTons: 19, bodyLengthsFt: ['32'] },
  { family: 'container', body: 'closed', wheel: 'txl', capacityTons: 20, bodyLengthsFt: ['32'] },
  { family: 'container', body: 'closed', wheel: 'txl', capacityTons: 24, bodyLengthsFt: ['32'] },
  { family: 'container', body: 'closed', wheel: 'txl', capacityTons: 25, bodyLengthsFt: ['32'] },
  { family: 'container', body: 'closed', wheel: 'txl', capacityTons: 30, bodyLengthsFt: ['32'] },
];

/** Picker step 2 tyre counts — a subset of WHEEL_COUNTS (no 22-wheel trailers in the drawer). */
export const PICKER_WHEEL_COUNTS = [4, 6, 10, 12, 14, 16, 18] as const;

export const AXLE_LABELS: Record<VehicleAxleType, string> = {
  sxl: 'SXL',
  sxl_hc_9_5: 'SXL 9.5 HC',
  sxl_hc_10: 'SXL 10 HC',
  mxl: 'MXL',
  txl: 'TXL',
};

const FAMILY_LABELS: Partial<Record<TruckBodyType, string>> = {
  open_body: 'Open Body',
  lcv_open_body: 'LCV Open Body',
  container: 'Container',
  lcv_container: 'LCV Container',
};

export interface TruckTypePick {
  body: PickerBody;
  wheel: PickerWheel;
  capacityTons: number;
  bodyLengthFt: string;
}

/** The picker row an exact pick lands on, or null when that combination isn't offered. */
export function findPickerRow(pick: TruckTypePick): TruckTypePickerRow | null {
  return (
    TRUCK_TYPE_PICKER_ROWS.find(
      (row) =>
        row.body === pick.body &&
        row.wheel === pick.wheel &&
        row.capacityTons === pick.capacityTons &&
        row.bodyLengthsFt.includes(pick.bodyLengthFt),
    ) ?? null
  );
}

/** The tenant truck_types name a pick is saved under, e.g. "Open Body · 12 tyre · 25T · 24ft". */
export function pickerTruckTypeName(row: TruckTypePickerRow, bodyLengthFt: string): string {
  const wheel = typeof row.wheel === 'number' ? `${row.wheel} tyre` : AXLE_LABELS[row.wheel];
  return `${FAMILY_LABELS[row.family]} · ${wheel} · ${row.capacityTons}T · ${bodyLengthFt}ft`;
}

/** Display label for a picker step-2 value: "6 tyre" or "MXL". */
export function pickerWheelLabel(wheel: PickerWheel): string {
  return typeof wheel === 'number' ? `${wheel} tyre` : AXLE_LABELS[wheel];
}
