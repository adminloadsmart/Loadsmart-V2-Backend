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
  truckTypeId?: string;
  truckLengthFt?: string;
  acceptedTruckTypeIds?: string[];
  vehicleId?: string;
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
  bodyType?: string;
  wheelConfiguration?: number;
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
