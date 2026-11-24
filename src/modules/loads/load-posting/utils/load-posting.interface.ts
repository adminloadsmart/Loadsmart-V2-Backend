import { PickerBody, PickerWheel } from '../../../masters/vehicle/truck-type-picker.constants';
import {
  AddressSource,
  BalancePaidBy,
  PostMode,
  PriceBasis,
  PriceMode,
  RecipientQuoteStep,
} from './load-posting.types';
import type { BidChannel, BidCounterStatus, BidStatus } from '../../utils/loads.types';
import type { LoadEntity } from '../../entities/load.entity';
import type { CreateLoadData } from '../../core/load.repository';
import type { DriverTenantRelationEntity } from '../../../driver/entities/driver-tenant-relation.entity';

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

export interface UnloadingAppointmentInput {
  appointmentId: string;
  /** YYYY-MM-DD */
  date: string;
  /** "10:00–12:00" */
  slot: string;
}

export interface PostLoadInput {
  mode: PostMode;
  customerId?: string;
  pickup: PickupInput;
  drop: DropInput;
  pickupAt: string;
  deliverByAt?: string;
  /** The drop warehouse's appointment — the alternative to Deliver by. Saved on every load as
   *  its unloading details. */
  unloadingAppointment?: UnloadingAppointmentInput;
  commodity: CommodityInput;
  packaging: string;
  weightTonnes?: number;
  /** Optional value of the cargo per MT — a shortage's value at risk (LS_N_0034). */
  cargoValuePerTonne?: number;
  truckCount: number;
  /** Main truck. Required for Market fleet and Indent; optional for Own fleet. */
  truck?: TruckPickInput;
  /** "Also accept" sizes — same body (open/closed) as the main truck. */
  acceptedTrucks?: TruckPickInput[];
  vehicleId?: string;
  /** Own fleet: a driver other than the truck's linked one — must be idle. */
  driverId?: string;
  /** Ignored: a market load goes to the transporters on its lane (lane-matching). Still accepted
   *  so older clients keep working. */
  transporterIds?: string[];
  /** Indent: the one contracted transporter. */
  transporterId?: string;
  price?: PriceInput;
  advancePercentage?: number;
  balancePaidBy?: BalancePaidBy;
  note?: string;
  /** Optional load title; blank is stored as none. */
  title?: string;
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
  /** Accepted for older clients; master contracts are not tied to a customer. */
  customerId?: string;
  pickupCity: string;
  pickupState: string;
  dropCity: string;
  dropState: string;
}

export interface CreateContractInput {
  customerId: string;
  transporterId: string;
  contractNumber: string;
  pickupCity: string;
  dropCity: string;
  rate: number;
  /** Owed by the transporter when it rejects an indent. */
  nonPlacementPenalty?: number;
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

/** Set by the Loadsmart ops module once built — every market posting opens a sourcing too. */
export interface LoadPostingHooks {
  onMarketLoadsPosted?: (loads: LoadEntity[], actorId: string | null) => Promise<void>;
  /** A market posting was edited before any bid — the Loadsmart sourcing re-reads it. */
  onMarketLoadsEdited?: (loads: LoadEntity[], actorId: string) => Promise<void>;
}

/** Area-level refinement of an address after bids: never the city or state the bids were given
 *  against. */
export interface AddressAreaInput {
  addressLine1?: string;
  areaLocality?: string;
  pinCode?: string;
  latitude?: number;
  longitude?: number;
}

/** What can still change once bids are in ("only pickup/drop at an area level and contacts" —
 *  the contacts have their own endpoints), plus the truck's reporting time. */
export interface EditPostingDetailsInput {
  pickupAt?: string;
  pickupArea?: AddressAreaInput;
  dropArea?: AddressAreaInput;
}

/** An own-fleet truck and driver that can take the trip (LoadPostingService's availability
 *  check) — the licence is checked afterwards, once the compliance check has run. */
export interface OwnFleetAssignment {
  defaults: Partial<CreateLoadData>;
  driverName: string | null;
  driverRelation: DriverTenantRelationEntity;
  grossVehicleWeightKg: number | null;
}

/** A transporter's bid on the load asked about, as shown on its "Who is quoting" row. */
export interface RecipientBidSummary {
  id: string;
  rate: string;
  vehicleNumber: string | null;
  /** VAHAN result for the truck: null = not checked yet. */
  truckVerified: boolean | null;
  status: BidStatus;
  channel: BidChannel;
  counterRate: string | null;
  counterStatus: BidCounterStatus | null;
  /** The shipper user who typed it in (a rate given by phone); null when sent on WhatsApp. */
  enteredBy: string | null;
  updatedAt: Date;
}

/** One transporter's step on one load, with when it happened. */
export interface RecipientQuote {
  step: RecipientQuoteStep;
  stepAt: Date | null;
  /** Delivered or seen, no answer for QUOTE_NO_ANSWER_CALL_AFTER_MS, load still open. */
  needsCall: boolean;
}
