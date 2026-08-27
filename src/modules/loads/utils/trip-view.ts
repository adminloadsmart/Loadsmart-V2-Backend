import { computeShareAmount } from '../load-payment.service';
import { LoadEntity } from '../entities/load.entity';
import {
  LIFECYCLE_STAGE_LABELS,
  LOAD_STATUSES,
  LoadSourceType,
  LoadStatus,
  MARKET_LIFECYCLE_STATUSES,
  OWN_FLEET_LIFECYCLE_STATUSES,
  PAYMENTS_STAGE,
} from './loads.types';

/**
 * Pure, stateless projections of a LoadEntity onto the Trips Home-page row, the trip-detail
 * screen's technical stepper, and its next-action summary — no DB/IO, no `this`, fully
 * unit-testable in isolation. Extracted out of load.service.ts (which still owns everything that
 * actually reads/writes a load) to mirror this module's own precedent for pure computation living
 * in utils/ — see fit-engine.ts for dispatch-planning's equivalent.
 */

/** One row of the Trips Home-page table — a flattened, display-ready projection of a Load plus
 *  its requisition's route/customer (neither of which the LoadEntity carries directly). */
export interface TripListRow {
  id: string;
  status: LoadStatus;
  requisitionId: string;
  route: {
    loadingPointTitle: string;
    loadingPointCity: string;
    deliveryPointLocation: string;
    deliveryPointCity: string | null;
  } | null;
  customer: { id: string; name: string } | null;
  vehicleNumber: string | null;
  driver: { id: string; fullName: string } | null;
  source: { type: LoadSourceType; label: string };
  plannedCapacityTonnes: string;
  freightValue: string | null;
  advance: { applicable: boolean; amount: string | null; paid: boolean; paidAt: string | null };
  balance: { applicable: boolean; amount: string | null; paid: boolean; paidAt: string | null };
  cargoItems: { productId: string; productDetails: string; tonnesPerTruck: string }[];
  /** Market only — the target/starting rate captured at planning (LoadEntity.expectedRate).
   *  Always null for own-fleet loads; the Freight column shows "Internal" for those instead. */
  expectedRate: string | null;
  createdAt: string;
}

/** One entry of the trip-detail screen's 8-step progress stepper — walks LOAD_STATUSES in the
 *  true backend order (loading_confirmed before at_plant). */
export interface TripStepperStep {
  key: LoadStatus;
  label: string;
  completed: boolean;
  current: boolean;
  /** ISO timestamp from the matching *_At column; null for 'created'/'assigned', which have no
   *  dedicated timestamp column on LoadEntity. */
  at: string | null;
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

function humanizeStatus(status: LoadStatus): string {
  const words = status.split('_');
  return `${words[0].charAt(0).toUpperCase()}${words[0].slice(1)} ${words.slice(1).join(' ')}`.trim();
}

export function toTripListRow(load: LoadEntity): TripListRow {
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
    status: load.status,
    requisitionId: load.requisitionId,
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
    driver: driver ? { id: driver.id, fullName: driver.fullName } : null,
    source:
      load.sourceType === 'own_fleet'
        ? { type: 'own_fleet', label: 'Own fleet' }
        : {
            type: 'market',
            label: load.transporter ? `Market · ${load.transporter.name}` : 'Market',
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
    createdAt: load.createdAt.toISOString(),
  };
}

/** Walks LOAD_STATUSES by index — the same indexing LoadService.updateStatus uses — to build
 *  the trip-detail screen's 8-step progress stepper. */
export function buildStepper(load: LoadEntity): TripStepperStep[] {
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
    label: humanizeStatus(status),
    completed: index < currentIndex,
    current: index === currentIndex,
    at: timestampByStatus[status]?.toISOString() ?? null,
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
export function buildNextAction(load: LoadEntity): TripNextAction {
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
    currentStageLabel: LIFECYCLE_STAGE_LABELS[currentStage],
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
