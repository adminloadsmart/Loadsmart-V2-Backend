import type { NAME_DRIVER_REFUSALS } from '../memo/load-memo.constants';
import type { LoadMemoEntity } from '../memo/load-memo.entity';
import type { MemoStatus } from './loads.types';
import type { LoadChecksView } from './load-verification.interface';

export type CreateLoadMemoData = Pick<
  LoadMemoEntity,
  | 'tenantId'
  | 'loadId'
  | 'transporterId'
  | 'vehicleNumber'
  | 'driverName'
  | 'driverMobile'
  | 'loadingContactName'
  | 'loadingContactPhone'
  | 'sentAt'
  | 'sentBy'
  | 'expiresAt'
  | 'version'
  | 'reference'
  | 'driverLicenceNumber'
  | 'freightType'
  | 'freightValue'
  | 'advancePercentage'
  | 'balancePercentage'
  | 'pdfFileKey'
>;

export interface NameDriverInput {
  driverName: string;
  driverMobile: string;
  /** Checked on Sarathi with the date of birth. */
  licenceNumber: string;
  /** YYYY-MM-DD. */
  dateOfBirth: string;
  /** The truck, when the load has none yet (not sent with the bid, or the truck was cancelled)
   *  or the transporter changes it — checked on VAHAN. */
  vehicleNumber?: string;
  /** Why the shipper entered details the transporter gave outside WhatsApp — logged. */
  reason?: string;
}

/** A refusal reason from NAME_DRIVER_REFUSALS. */
export type NameDriverRefusal = (typeof NAME_DRIVER_REFUSALS)[keyof typeof NAME_DRIVER_REFUSALS];

/** The `details` of a refused "name the driver". */
export interface NameDriverRefusalDetails {
  reason: NameDriverRefusal;
  vehicleNumber?: string;
}

export interface NameDriverOptions {
  /** Save the driver and run the checks, but don't send the memo even when they pass — the
   *  details came from a Loadsmart partner on WhatsApp and Placement sends the memo after its
   *  review (re-run checks / manual verification). */
  holdMemo?: boolean;
}

/** What naming the driver (or re-running the checks) produced: the memo, or — while a check
 *  failed or couldn't run — no memo and what blocks it ("A failed check sits next to the truck
 *  number or driver name"). */
export interface NameDriverResult {
  memo: MemoView | null;
  checks: LoadChecksView;
  /** The driver as saved on the load. When the licence is already on file (masters.drivers),
   *  the name, mobile and date of birth come from that record, not from what was typed. */
  driver?: {
    name: string;
    mobile: string;
    dateOfBirth: string;
    /** The masters.drivers row the licence matched; null when the licence isn't on file. */
    driverOnRecordId: string | null;
  };
}

/** Who receives the truck at the loading point — overrides the posting's when given. */
export interface LoadingContact {
  name?: string;
  phone?: string;
}

export interface AcceptMemoInput {
  loadingContactName?: string;
  loadingContactPhone?: string;
  loadingPointNote?: string;
}

export interface MemoView extends Omit<LoadMemoEntity, 'load' | 'status'> {
  status: MemoStatus;
}
