import { PickerBody, PickerWheel } from '../../../masters/vehicle/truck-type-picker.constants';
import {
  AddressSource,
  BalancePaidBy,
  PostMode,
  PriceBasis,
  PriceMode,
} from './load-posting.types';

/** A new (not yet in any master) address, picked from Google Maps or the pincode lookup. Saved to
 *  the right master only when the load is posted. */
export interface NewAddressInput {
  label: string;
  addressLine1?: string;
  areaLocality?: string;
  city: string;
  state: string;
  pinCode: string;
  latitude?: number;
  longitude?: number;
  source: Exclude<AddressSource, 'master'>;
}

export interface PickupInput {
  loadingPointId?: string;
  newAddress?: NewAddressInput;
}

export interface DropInput {
  /** The customer's saved unloading point. */
  customerDeliveryPointId?: string;
  /** No customer: one of the shipper's own saved locations (loading point master). */
  loadingPointId?: string;
  newAddress?: NewAddressInput;
}

export interface CommodityInput {
  productId?: string;
  /** A name not in the commodity master — saved to the master on post. */
  name?: string;
}

export interface PriceInput {
  mode: PriceMode;
  basis?: PriceBasis;
  rate?: number;
}

/** One truck-type pick from the fixed picker table (body, then tyres or axle, then tonnes, then
 *  length) — the same table the Add Truck drawer uses. Resolved to a Truck master row on post. */
export interface TruckPickInput {
  body: PickerBody;
  wheel: PickerWheel;
  capacityTons: number;
  bodyLengthFt: string;
}

export interface PostLoadInput {
  mode: PostMode;
  customerId?: string;
  pickup: PickupInput;
  drop: DropInput;
  pickupAt: string;
  deliverByAt?: string;
  commodity: CommodityInput;
  packaging: string;
  weightTonnes?: number;
  truckCount: number;
  /** Main truck. Required for Market fleet and Indent; optional for Own fleet. */
  truck?: TruckPickInput;
  /** "Also accept" sizes — same body (open/closed) as the main truck. */
  acceptedTrucks?: TruckPickInput[];
  vehicleId?: string;
  /** Own fleet: a driver other than the truck's linked one — must be idle. */
  driverId?: string;
  /** Market fleet: the ticked transporters (Loadsmart is always added). */
  transporterIds?: string[];
  /** Indent: the one contracted transporter. */
  transporterId?: string;
  price?: PriceInput;
  advancePercentage?: number;
  balancePaidBy?: BalancePaidBy;
  note?: string;
}

export interface PostLoadParams {
  idempotencyKey?: string;
}

export interface RecentCustomersInput {
  limit: number;
}

export interface CustomerSearchInput {
  search?: string;
  limit: number;
}

export interface PastLoadsInput {
  customerId?: string;
}

export interface UnloadingPointsInput {
  search?: string;
}

export interface LoadingPointSearchInput {
  search?: string;
}

export interface TransportersInput {
  search?: string;
}

export interface ContractsQueryInput {
  customerId: string;
  pickupCity?: string;
  dropCity?: string;
}

export interface CreateContractInput {
  customerId: string;
  transporterId: string;
  contractNumber: string;
  pickupCity: string;
  dropCity: string;
  rate: number;
  validFrom: string;
  validTo: string;
}

export interface TruckOptionsInput {
  body?: PickerBody;
  /** Tyre count (e.g. "6") or axle type (e.g. "mxl"). */
  wheel?: PickerWheel;
  capacityTons?: number;
}

export interface FleetOptionsInput {
  search?: string;
}

export interface DraftBody {
  payload: Record<string, unknown>;
}

export interface DraftParams {
  draftId: string;
}
