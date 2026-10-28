import { LoadEntity } from '../entities/load.entity';
import { PostAddress } from '../load-posting/utils/load-posting.types';

export interface LoadPickupPlace {
  title: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string;
  state: string | null;
  pinCode: string | null;
}

export interface LoadDropPlace {
  location: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pinCode: string | null;
}

/** Where a load comes from and goes to, resolved from its requisition (Dispatch Planning) or, for a
 *  load posted without one, from its posting. */
export interface LoadOrigin {
  customer: { id: string; name: string } | null;
  pickup: LoadPickupPlace | null;
  drop: LoadDropPlace | null;
  /** YYYY-MM-DD */
  pickupDate: string | null;
  /** YYYY-MM-DD */
  expectedDeliveryDate: string | null;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The posting stores timestamps; requisitions store plain dates — use the IST calendar day. */
function istDate(value: Date | null): string | null {
  return value ? new Date(value.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10) : null;
}

function pickupFromAddress(address: PostAddress | null): LoadPickupPlace | null {
  if (!address?.city) return null;
  return {
    title: address.label,
    addressLine1: address.addressLine1,
    addressLine2: address.areaLocality,
    city: address.city,
    state: address.state,
    pinCode: address.pinCode,
  };
}

function dropFromAddress(address: PostAddress | null): LoadDropPlace | null {
  if (!address) return null;
  return {
    location: address.label,
    addressLine1: address.addressLine1,
    addressLine2: address.areaLocality,
    city: address.city,
    state: address.state,
    pinCode: address.pinCode,
  };
}

/** Needs `requisition` and/or `posting` (with its customer and point relations) loaded. A loading
 *  point changed on the load itself (`loadingPoint`, when loaded) replaces the pickup. */
export function resolveLoadOrigin(load: LoadEntity): LoadOrigin {
  const origin = resolvePlannedOrigin(load);
  return load.loadingPoint ? { ...origin, pickup: load.loadingPoint } : origin;
}

function resolvePlannedOrigin(load: LoadEntity): LoadOrigin {
  const req = load.requisition;
  if (req) {
    return {
      customer: req.customer ? { id: req.customer.id, name: req.customer.name } : null,
      pickup: req.loadingPoint,
      drop: req.customerDeliveryPoint,
      pickupDate: req.pickupDate,
      expectedDeliveryDate: req.expectedDeliveryDate,
    };
  }

  const posting = load.posting;
  if (!posting) {
    return {
      customer: null,
      pickup: null,
      drop: null,
      pickupDate: null,
      expectedDeliveryDate: null,
    };
  }
  const dropLoadingPoint = posting.dropLoadingPoint;
  return {
    customer: posting.customer ? { id: posting.customer.id, name: posting.customer.name } : null,
    pickup: posting.pickupLoadingPoint ?? pickupFromAddress(posting.pickupAddress),
    drop:
      posting.dropCustomerDeliveryPoint ??
      (dropLoadingPoint ? { ...dropLoadingPoint, location: dropLoadingPoint.title } : null) ??
      dropFromAddress(posting.dropAddress),
    pickupDate: istDate(posting.pickupAt),
    expectedDeliveryDate: istDate(posting.deliverByAt),
  };
}
