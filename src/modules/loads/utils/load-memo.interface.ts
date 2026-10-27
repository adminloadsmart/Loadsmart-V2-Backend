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
>;

export interface NameDriverInput {
  driverName: string;
  driverMobile: string;
  /** Checked on Sarathi with the date of birth. */
  licenceNumber: string;
  /** YYYY-MM-DD. */
  dateOfBirth: string;
}

/** What naming the driver produced: the memo, or — when a truck or driver check failed — no memo
 *  and the failures to fix ("A failed check sits next to the truck number or driver name"). */
export interface NameDriverResult {
  memo: MemoView | null;
  checks: LoadChecksView;
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
