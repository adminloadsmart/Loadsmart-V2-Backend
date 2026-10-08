import { computeShareAmount } from '../load-payment.service';
import { LoadEntity } from '../entities/load.entity';
import { LoadIssueReportEntity } from '../entities/load-issue-report.entity';
import { DEFAULT_LOCALE, Locale } from '../../../shared/i18n/locales';
import { t } from '../../../shared/i18n/translate';
import { EwayBillExpiry } from './load.interface';
import { VehicleBodyType, VehicleFuelType } from '../../masters/vehicle/vehicle.type';
import {
  HALTING_ISSUE_CATEGORIES,
  LIFECYCLE_STAGE_LABEL_KEYS,
  LOAD_STATUSES,
  LoadIssueCategory,
  LoadSourceType,
  LoadStatus,
  MARKET_LIFECYCLE_STATUSES,
  OWN_FLEET_LIFECYCLE_STATUSES,
  PAYMENTS_STAGE,
  PodStatus,
  SealStatus,
  ShortageOrDamageStatus,
} from './loads.types';

/**
 * Pure, stateless projections of a LoadEntity onto the Trips Home-page row, the trip-detail
 * screen's technical stepper, and its next-action summary — no DB/IO, no `this`, fully
 * unit-testable in isolation. Extracted out of load.service.ts (which still owns everything that
 * actually reads/writes a load) to mirror this module's own precedent for pure computation living
 * in utils/ — see fit-engine.ts for dispatch-planning's equivalent.
 */

/** Vehicle details for a trip/load row — own-fleet resolves these from the linked VehicleEntity;
 *  market loads have no Vehicle master record (see load.entity.ts's own doc comments), so `type`
 *  falls back to the load's own market-only truckType/feetWheels and every other field is null.
 *  Null overall only when the load has no vehicleNumber, vehicle, or truckType at all yet (e.g.
 *  not assigned). */
export interface TripVehicleDetails {
  registrationNumber: string | null;
  type: string | null;
  bodyType: VehicleBodyType | null;
  fuelType: VehicleFuelType | null;
  capacityTons: string | null;
  wheelCount: number | null;
  /** Market only — free-text feet/wheels configuration entered at Assignment; own-fleet loads
   *  carry a real wheelCount on the vehicle instead. */
  feetWheels: string | null;
}

function buildVehicleDetails(load: LoadEntity): TripVehicleDetails | null {
  if (!load.vehicleNumber && !load.vehicle && !load.truckType) return null;
  return {
    registrationNumber: load.vehicleNumber,
    type: load.vehicle?.truckType?.name ?? load.truckType?.name ?? null,
    bodyType: load.vehicle?.bodyType ?? null,
    fuelType: load.vehicle?.fuelType ?? null,
    capacityTons: load.vehicle?.capacityTons ?? null,
    wheelCount: load.vehicle?.wheelCount ?? null,
    feetWheels: load.vehicle ? null : load.feetWheels,
  };
}

/** One row of the Trips Home-page table — a flattened, display-ready projection of a Load plus
 *  its requisition's route/customer (neither of which the LoadEntity carries directly). */
export interface TripListRow {
  id: string;
  /** Display code `LOAD-nnnn` — see load.entity.ts's doc comment. */
  code: string;
  status: LoadStatus;
  requisitionId: string;
  /** The parent requisition's own display code `REQ-nnnn` — null only if the requisition
   *  relation somehow wasn't loaded (never happens via LoadRepository.list). */
  requisitionCode: string | null;
  /** The requisition's planned pickup date (YYYY-MM-DD) — null only if the relation wasn't loaded. */
  pickupDate: string | null;
  route: {
    loadingPointTitle: string;
    loadingPointCity: string;
    deliveryPointLocation: string;
    deliveryPointCity: string | null;
  } | null;
  customer: { id: string; name: string } | null;
  vehicleNumber: string | null;
  vehicle: TripVehicleDetails | null;
  /** Own-fleet: the Driver-master row backing this load's driver snapshot. Market: the free-text
   *  driverName entered at Assignment, with `id: null` since no Driver-master row backs it. */
  driver: { id: string | null; fullName: string } | null;
  source: { type: LoadSourceType; label: string };
  plannedCapacityTonnes: string;
  freightValue: string | null;
  advance: { applicable: boolean; amount: string | null; paid: boolean; paidAt: string | null };
  balance: { applicable: boolean; amount: string | null; paid: boolean; paidAt: string | null };
  cargoItems: { productId: string; productDetails: string; tonnesPerTruck: string }[];
  /** Market only — the target/starting rate captured at planning (LoadEntity.expectedRate).
   *  Always null for own-fleet loads; the Freight column shows "Internal" for those instead. */
  expectedRate: string | null;
  /** null until the first E-POD upload. 'pending'/'rejected' rows are what the driver app's Open
   *  Trips tab surfaces — see LoadEntity's doc comment. */
  podStatus: PodStatus | null;
  /** Staff's reason when podStatus is 'rejected' — shown to the driver before they resubmit via
   *  the same uploadPod endpoint. Always null otherwise. */
  podRejectionReason: string | null;
  createdAt: string;
}

/** One entry of the trip-detail screen's 8-step progress stepper — walks LOAD_STATUSES in the
 *  true backend order (at_plant before loading_confirmed). */
export interface TripStepperStep {
  key: LoadStatus;
  label: string;
  completed: boolean;
  current: boolean;
  /** ISO timestamp from the matching *_At column; null for 'created'/'assigned', which have no
   *  dedicated timestamp column on LoadEntity. */
  at: string | null;
  /** True for the steps still ahead of the current one while the load is halted by an unresolved
   *  accident/breakdown — the driver app renders them as "ON HOLD". */
  onHold: boolean;
}

/** The load's newest unresolved driver-reported issue, shown on the trip-detail screen as the
 *  incident card. `halted` is true only for HALTING_ISSUE_CATEGORIES — other categories are info
 *  only and don't stop the trip. */
export interface TripIncident {
  id: string;
  category: LoadIssueCategory;
  details: string | null;
  locationLabel: string;
  reportedAt: string;
  halted: boolean;
}

export function buildIncident(issue: LoadIssueReportEntity | null): TripIncident | null {
  if (!issue) return null;
  return {
    id: issue.id,
    category: issue.category,
    details: issue.details,
    locationLabel: issue.locationLabel,
    reportedAt: issue.createdAt.toISOString(),
    halted: HALTING_ISSUE_CATEGORIES.includes(issue.category),
  };
}

export interface TripNextAction {
  nextStatus: LoadStatus | null;
  /** Plan Dispatch v2.0 §11/R-38 — counted against the load's OWN sourcing strategy's lifecycle
   *  (Own Fleet: 4 steps; Market: 6, the 6th being the derived "Payments" stage), not a single
   *  shared count across every load — see resolveLifecycleStage below. 0 before the first stage;
   *  capped at `totalSteps` once fully complete. */
  stepNumber: number;
  totalSteps: number;
  /** Doc-exact label (Plan Dispatch v2.0 §11) for the stage `stepNumber` currently sits at — e.g.
   *  "Truck assigned", "In-transit", or (Market only, once both payments clear) "Payments". */
  currentStageLabel: string;
  lastUpdate: { status: LoadStatus; at: string | null };
  advance: { applicable: boolean; amount: string | null; paid: boolean; paidAt: string | null };
  balance: { applicable: boolean; amount: string | null; paid: boolean; paidAt: string | null };
}

export function toTripListRow(load: LoadEntity, locale: Locale = DEFAULT_LOCALE): TripListRow {
  const req = load.requisition;

  // Own-fleet loads snapshot the vehicle's driver at Dispatch Planning time (see
  // dispatch-planning.service.ts's buildOwnFleetLine), so `load.driver` is null whenever the
  // vehicle had no driver linked yet at that moment. Fall back to whichever driver-link is
  // currently active and primary on the vehicle, so the trip still shows a driver once one exists.
  const currentVehicleDriver = load.vehicle?.driverLinks?.find(
    (link) => link.status === 'active' && link.isPrimary,
  )?.driver;
  const driver = load.driver ?? currentVehicleDriver ?? null;

  // Advance/balance amounts mirror buildNextAction's computation below — market-only, derived
  // from freightValue + plannedCapacityTonnes + the stored percentages via computeShareAmount.
  const isMarket = load.sourceType === 'market';
  const advanceAmount =
    isMarket && load.freightValue ? computeShareAmount(load, load.advancePercentage ?? '0') : null;
  const balanceAmount =
    isMarket && load.freightValue ? computeShareAmount(load, load.balancePercentage ?? '0') : null;

  return {
    id: load.id,
    code: load.code,
    status: load.status,
    requisitionId: load.requisitionId,
    requisitionCode: req?.code ?? null,
    pickupDate: req?.pickupDate ?? null,
    route: req
      ? {
          loadingPointTitle: req.loadingPoint.title,
          loadingPointCity: req.loadingPoint.city,
          deliveryPointLocation: req.customerDeliveryPoint.location,
          deliveryPointCity: req.customerDeliveryPoint.city ?? null,
        }
      : null,
    customer: req ? { id: req.customer.id, name: req.customer.name } : null,
    vehicleNumber: load.vehicleNumber,
    vehicle: buildVehicleDetails(load),
    driver: driver
      ? { id: driver.id, fullName: driver.fullName }
      : load.driverName
        ? { id: null, fullName: load.driverName }
        : null,
    source:
      load.sourceType === 'own_fleet'
        ? { type: 'own_fleet', label: t(locale, 'loads.source.ownFleet') }
        : {
            type: 'market',
            label: load.transporter
              ? t(locale, 'loads.source.marketWithTransporter', {
                  transporter: load.transporter.name,
                })
              : t(locale, 'loads.source.market'),
          },
    plannedCapacityTonnes: load.plannedCapacityTonnes,
    freightValue: load.freightValue,
    advance: {
      applicable: isMarket,
      amount: advanceAmount,
      paid: Boolean(load.advancePaidAt),
      paidAt: load.advancePaidAt?.toISOString() ?? null,
    },
    balance: {
      applicable: isMarket,
      amount: balanceAmount,
      paid: Boolean(load.balancePaidAt),
      paidAt: load.balancePaidAt?.toISOString() ?? null,
    },
    cargoItems: (load.cargoItems ?? []).map((item) => ({
      productId: item.productId,
      productDetails: item.product.productDetails,
      tonnesPerTruck: item.tonnesPerTruck,
    })),
    expectedRate: load.sourceType === 'own_fleet' ? null : load.expectedRate,
    podStatus: load.podStatus,
    podRejectionReason: load.podRejectionReason,
    createdAt: load.createdAt.toISOString(),
  };
}

/** Driver-app "Trip Done" detail screen — a single-pickup, single-drop summary of a completed
 *  trip's receipt. Deliberately not the full LoadDetailView (payments/stepper/nextAction are
 *  staff-oriented and meaningless once a trip is closed) — see load.service.ts's
 *  getMyTripDetail. Today's data model is one requisition = one delivery point = one E-POD per
 *  load, so there's exactly one `drop`, not the multiple stops a future multi-drop trip might
 *  show; see load.service.ts's TripDoneDetail doc comment. */
export interface TripDoneDetail {
  id: string;
  code: string;
  status: LoadStatus;
  isClosed: boolean;
  vehicleNumber: string | null;
  vehicle: TripVehicleDetails | null;
  /** Joined product names — e.g. "Electronics, Hardware" — for the screen's payload-description
   *  line. Empty string if no cargo items are loaded (shouldn't happen for a delivered trip). */
  cargoSummary: string;
  cargoItems: { productId: string; productDetails: string; tonnesPerTruck: string }[];
  /** Tonnage planned/loaded at pickup — the screen's "Loaded X T Total". */
  plannedCapacityTonnes: string;
  /** Tonnage the receiver actually signed for — the screen's "Unloaded X T" and "CARGO NET"
   *  tile. Null until uploadPod runs (always populated for a 'delivered'/'closed' load). */
  podQuantityReceived: string | null;
  pickup: {
    title: string;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string;
    pinCode: string;
    /** ISO timestamp — loadingConfirmedAt, when the truck was loaded and left the pickup point. */
    at: string | null;
  } | null;
  drop: {
    location: string;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    pinCode: string | null;
    deliveredAt: string | null;
    sealStatus: SealStatus | null;
    shortageOrDamage: ShortageOrDamageStatus | null;
    numberOfTonnesShort: string | null;
    podRemarks: string | null;
    /** ISO time the receiver's code was verified; null = no phone (photo-only) or staff-recorded. */
    receiverVerifiedAt: string | null;
    /** Staff-review state of this trip's E-POD — see LoadEntity's doc comment. Also reachable
     *  (deliberately) for a load that's 'delivered' but not yet 'closed', so a rejected trip's
     *  driver can see why and re-upload via the same uploadPod endpoint. */
    podStatus: PodStatus | null;
    podRejectionReason: string | null;
  } | null;
  closedAt: string | null;
}

export function toTripDoneDetail(load: LoadEntity): TripDoneDetail {
  const req = load.requisition;
  const cargoItems = (load.cargoItems ?? []).map((item) => ({
    productId: item.productId,
    productDetails: item.product.productDetails,
    tonnesPerTruck: item.tonnesPerTruck,
  }));

  return {
    id: load.id,
    code: load.code,
    status: load.status,
    isClosed: load.status === 'closed',
    vehicleNumber: load.vehicleNumber,
    vehicle: buildVehicleDetails(load),
    cargoSummary: cargoItems.map((item) => item.productDetails).join(', '),
    cargoItems,
    plannedCapacityTonnes: load.plannedCapacityTonnes,
    podQuantityReceived: load.podQuantityReceived,
    pickup: req
      ? {
          title: req.loadingPoint.title,
          addressLine1: req.loadingPoint.addressLine1,
          addressLine2: req.loadingPoint.addressLine2,
          city: req.loadingPoint.city,
          state: req.loadingPoint.state,
          pinCode: req.loadingPoint.pinCode,
          at: load.loadingConfirmedAt?.toISOString() ?? null,
        }
      : null,
    drop: req
      ? {
          location: req.customerDeliveryPoint.location,
          addressLine1: req.customerDeliveryPoint.addressLine1,
          addressLine2: req.customerDeliveryPoint.addressLine2,
          city: req.customerDeliveryPoint.city,
          state: req.customerDeliveryPoint.state,
          pinCode: req.customerDeliveryPoint.pinCode,
          deliveredAt: load.deliveredAt?.toISOString() ?? null,
          sealStatus: load.sealStatus,
          shortageOrDamage: load.shortageOrDamage,
          numberOfTonnesShort: load.numberOfTonnesShort,
          podRemarks: load.podRemarks,
          receiverVerifiedAt: load.podReceiverVerifiedAt?.toISOString() ?? null,
          podStatus: load.podStatus,
          podRejectionReason: load.podRejectionReason,
        }
      : null,
    closedAt: load.closedAt?.toISOString() ?? null,
  };
}

export const LOAD_PAPER_TYPES = ['eway_bill', 'lr', 'invoice'] as const;
export type LoadPaperType = (typeof LOAD_PAPER_TYPES)[number];

export interface LoadPaper {
  type: LoadPaperType;
  /** True when a number or a file is on record — false means the driver hasn't uploaded it yet. */
  available: boolean;
  number: string | null;
  /** Short-lived signed download URL; null when no file is on record or it isn't confirmed. */
  fileUrl: string | null;
  /** E-way bill only. */
  validTill?: string | null;
  expired?: boolean;
}

/** Driver-app "Show papers" screen — the load's E-way bill / LR / Invoice, always all three in
 *  that order (the screen's tabs), with unuploaded ones empty rather than omitted. See
 *  load.service.ts's getMyDocuments. */
export interface LoadPapers {
  loadId: string;
  loadCode: string;
  status: LoadStatus;
  vehicleNumber: string | null;
  route: {
    from: { title: string; city: string };
    to: { location: string; city: string | null };
  } | null;
  documents: LoadPaper[];
}

export function toLoadPapers(
  load: LoadEntity,
  fileUrls: Record<LoadPaperType, string | null>,
  ewayBillExpiry: EwayBillExpiry,
): LoadPapers {
  const req = load.requisition;
  const paper = (
    type: LoadPaperType,
    number: string | null,
    fileKey: string | null,
  ): LoadPaper => ({
    type,
    available: Boolean(number || fileKey),
    number,
    fileUrl: fileUrls[type],
  });

  return {
    loadId: load.id,
    loadCode: load.code,
    status: load.status,
    vehicleNumber: load.vehicleNumber,
    route: req
      ? {
          from: { title: req.loadingPoint.title, city: req.loadingPoint.city },
          to: {
            location: req.customerDeliveryPoint.location,
            city: req.customerDeliveryPoint.city ?? null,
          },
        }
      : null,
    documents: [
      {
        ...paper('eway_bill', load.ewayBillNumber, load.ewayBillFileKey),
        validTill: ewayBillExpiry.expiresAt,
        expired: ewayBillExpiry.expired,
      },
      paper('lr', load.elrNumber, load.elrFileKey),
      paper('invoice', load.invoiceNumber, load.invoiceFileKey),
    ],
  };
}

/** Walks LOAD_STATUSES by index — the same indexing LoadService.updateStatus uses — to build
 *  the trip-detail screen's 8-step progress stepper. */
export function buildStepper(
  load: LoadEntity,
  locale: Locale = DEFAULT_LOCALE,
  incident: TripIncident | null = null,
): TripStepperStep[] {
  const currentIndex = LOAD_STATUSES.indexOf(load.status);
  const timestampByStatus: Partial<Record<LoadStatus, Date | null>> = {
    loading_confirmed: load.loadingConfirmedAt,
    at_plant: load.atPlantAt,
    in_transit: load.inTransitAt,
    reached_delivery_point: load.reachedDeliveryPointAt,
    delivered: load.deliveredAt,
    closed: load.closedAt,
  };
  return LOAD_STATUSES.map((status, index) => ({
    key: status,
    label: t(locale, `loads.status.${status}`),
    completed: index < currentIndex,
    current: index === currentIndex,
    at: timestampByStatus[status]?.toISOString() ?? null,
    onHold: Boolean(incident?.halted) && index > currentIndex,
  }));
}

/**
 * Collapses a load's technical LOAD_STATUSES value onto the doc-aligned lifecycle stage it
 * belongs to (Plan Dispatch v2.0 §11/R-38): loading_confirmed/at_plant fold into the preceding
 * "Truck assigned"/"Load created" stage (they're still real, separately-timestamped statuses —
 * see buildStepper's 8-step technical view — just not named separately in the doc's simplified,
 * per-strategy lifecycle), and 'closed' folds into 'delivered'. Market Fleet's "Payments" stage
 * isn't a LoadStatus at all — advance/balance run in parallel with movement (LoadEntity's doc
 * comment) — so it's derived from both payment timestamps being set, independent of whether
 * `status` still reads 'delivered' or has since moved to 'closed'.
 */
function resolveLifecycleStage(load: LoadEntity): LoadStatus | typeof PAYMENTS_STAGE {
  if (load.sourceType === 'market' && load.advancePaidAt && load.balancePaidAt) {
    return PAYMENTS_STAGE;
  }
  if (load.status === 'loading_confirmed' || load.status === 'at_plant') return 'assigned';
  if (load.status === 'closed') return 'delivered';
  return load.status;
}

/** Next-action panel — what stage comes next, tracking/advance-due info. Advance/balance
 *  applicability and paid-state mirror the exact gating LoadPaymentService.recordAdvance/
 *  recordBalance already enforce (market-only, gated by loadingConfirmedAt/deliveredAt). */
export function buildNextAction(load: LoadEntity, locale: Locale = DEFAULT_LOCALE): TripNextAction {
  const currentIndex = LOAD_STATUSES.indexOf(load.status);
  const nextStatus = LOAD_STATUSES[currentIndex + 1] ?? null;

  const isMarket = load.sourceType === 'market';
  // Own Fleet's doc lifecycle is 4 stages; Market's is 6 (5 real statuses + the derived
  // "Payments" stage) — R-38, not one shared count across every load regardless of strategy.
  const lifecycleStatuses = isMarket ? MARKET_LIFECYCLE_STATUSES : OWN_FLEET_LIFECYCLE_STATUSES;
  const totalSteps = lifecycleStatuses.length + (isMarket ? 1 : 0);

  const currentStage = resolveLifecycleStage(load);
  const stepNumber =
    currentStage === PAYMENTS_STAGE ? totalSteps : lifecycleStatuses.indexOf(currentStage) + 1;

  const advanceAmount =
    isMarket && load.freightValue ? computeShareAmount(load, load.advancePercentage ?? '0') : null;
  const balanceAmount =
    isMarket && load.freightValue ? computeShareAmount(load, load.balancePercentage ?? '0') : null;

  return {
    nextStatus,
    stepNumber,
    totalSteps,
    currentStageLabel: t(locale, LIFECYCLE_STAGE_LABEL_KEYS[currentStage]),
    lastUpdate: { status: load.status, at: load.updatedAt?.toISOString() ?? null },
    advance: {
      applicable: isMarket,
      amount: advanceAmount,
      paid: Boolean(load.advancePaidAt),
      paidAt: load.advancePaidAt?.toISOString() ?? null,
    },
    balance: {
      applicable: isMarket,
      amount: balanceAmount,
      paid: Boolean(load.balancePaidAt),
      paidAt: load.balancePaidAt?.toISOString() ?? null,
    },
  };
}
