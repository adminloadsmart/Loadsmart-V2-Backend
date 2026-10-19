import { NotificationTriggers } from './notification-triggers';
import type { TrackingClient } from '../../adapters/tracking.client';
import type { AssignmentCompliance, AssignmentTarget } from '../loads/utils/load.interface';
import { ARRIVED_AT_DELIVERY_STATUSES, LoadStatus } from '../loads/utils/loads.types';
import {
  AdvanceDueContext,
  AssignmentComplianceFailedContext,
  assignmentBlockKeyOf,
  DeliveryLateContext,
  RouteDeviationContext,
  TrackingSignalLostContext,
  EwayBillExpiryContext,
  LoadSummary,
  PodUploadedContext,
  VehicleAssignedContext,
  DetentionAtLoadingContext,
  DetentionAtUnloadingContext,
  TripCompletedContext,
  VehicleHaltedContext,
  VehicleInTransitContext,
  VehicleLoadedContext,
  VehicleNotReportedContext,
  VehicleReachedDropContext,
  VehicleReachedPickupContext,
} from './catalog/notification-catalog';
import { findHaltExclusion, HaltGeofences } from './halt-exclusions';
import { LoadAlertRepository } from './load-alert.repository';
import {
  ASSIGNMENT_BLOCK_ALERT_WINDOW_MS,
  BANK_NAME_BY_IFSC_PREFIX,
  EWAY_BILL_ALERT_LEAD_MS,
  MS_PER_HOUR,
  TRIP_COMPLETED_FALLBACK_MS,
  MS_PER_MINUTE,
  VEHICLE_HALT_SAME_SPOT_M,
} from './notifications.constants';
import { LoadAlertSnapshot, LoadEventNotifier } from './notifications.interface';
import {
  distanceKmBetween,
  distanceMetresBetween,
  formatIndiaDateTime,
  promisedAtOf,
  reportingAtOf,
} from './utils/trip-time';

/**
 * Load-event notifications: reached the delivery point (LS_N_0031), trip completed (LS_N_0033, with
 * the E-POD), e-way bill expiry (LS_N_0025), E-POD uploaded, advance due, truck assigned (LS_N_0016), assignment blocked on compliance (LS_N_0017)
 * and vehicle loaded (LS_N_0024). LoadService calls the notifier after its own writes — it only
 * queues ids and never throws (same contract as breakdown-alerts.ts); the trigger worker's
 * resolvers below then read everything the message needs, and return null (nothing sent) once it
 * no longer applies. LS_N_0026 (vehicle in transit) comes from tracking instead — see
 * tracking-events.consumer.ts.
 */
export function createLoadEventNotifier(triggers: NotificationTriggers): LoadEventNotifier {
  return async (event) => {
    const { tenantId } = event;
    const loadId = event.loadId ?? '';
    try {
      switch (event.kind) {
        case 'in_transit':
          // Loading confirmed is when an advance can first be recorded; the resolver drops it
          // for own-fleet loads, no advance share, or an advance already paid. The "left the
          // loading point" card is LS_N_0026, triggered by tracking's geofence exit instead.
          await triggers.enqueue('load.advance_due', tenantId, { loadId });
          return;
        case 'at_plant':
          await triggers.enqueue('load.vehicle_reached_pickup', tenantId, {
            loadId,
            arrivedAt: event.at.toISOString(),
          });
          return;
        case 'reached_delivery_point':
          await triggers.enqueue('load.vehicle_reached_drop', tenantId, {
            loadId,
            arrivedAt: event.at.toISOString(),
          });
          return;
        case 'loading_confirmed':
          await triggers.enqueue('load.vehicle_loaded', tenantId, {
            loadId,
            loadedAt: event.at.toISOString(),
            confirmedBy: event.confirmedBy,
            ewayBillExpiresAt: event.ewayBillExpiresAt?.toISOString() ?? null,
          });
          return;
        case 'eway_bill_generated': {
          const sendInMs = event.expiresAt.getTime() - EWAY_BILL_ALERT_LEAD_MS - Date.now();
          await triggers.enqueue(
            'load.eway_bill_expiry',
            tenantId,
            {
              loadId,
              generatedAt: event.generatedAt.toISOString(),
              expiresAt: event.expiresAt.toISOString(),
            },
            { delayMs: Math.max(1, sendInMs) },
          );
          return;
        }
        case 'pod_uploaded':
          await triggers.enqueue('load.pod_uploaded', tenantId, {
            loadId,
            uploadedAt: event.at.toISOString(),
          });
          // LS_N_0033 — unloading is confirmed. Sent now if the vehicle has already left the
          // delivery point (or there's no geofence exit to wait for), else on tracking's exit;
          // the later retry completes the trip even if that exit never comes.
          await triggers.enqueue('load.trip_completed', tenantId, { loadId });
          await triggers.enqueue(
            'load.trip_completed',
            tenantId,
            { loadId, fallback: true },
            { delayMs: TRIP_COMPLETED_FALLBACK_MS },
          );
          return;
        case 'assigned':
          await triggers.enqueue('load.vehicle_assigned', tenantId, {
            loadId,
            assignedAt: event.at.toISOString(),
            vehicleChecked: event.vehicleChecked,
            driverChecked: event.driverChecked,
          });
          return;
        case 'assignment_blocked':
          await triggers.enqueue('load.assignment_compliance_failed', tenantId, {
            blockedAt: event.at.toISOString(),
            loadId: event.loadId ?? null,
            requisitionId: event.requisitionId ?? null,
            vehicleNo: event.vehicleNumber,
            vehicleId: event.vehicleId,
            driverId: event.driverId,
            driverName: event.driverName,
            subject: event.subject,
            docType: event.docType,
            expiryDate: event.expiryDate,
            transporterName: event.transporterName ?? null,
            origin: event.originCity ?? null,
            destination: event.destinationCity ?? null,
            pickupAt: event.pickupAt?.toISOString() ?? null,
          });
          return;
      }
    } catch (error) {
      const target =
        event.kind === 'assignment_blocked' ? (event.loadId ?? event.requisitionId) : event.loadId;
      console.warn(
        `Failed to queue ${event.kind} notification for ${target ?? 'a new load'}`,
        error,
      );
    }
  };
}

/** LS_N_0029's "running trip": At plant through to the delivery point (tracking watches the same
 *  statuses). */
const SIGNAL_WATCHED_STATUSES: readonly string[] = [
  'at_plant',
  'loading_confirmed',
  'in_transit',
  'reached_delivery_point',
];

const formatRupees = (amount: number) => `₹${Math.round(amount).toLocaleString('en-IN')}`;

function summaryOf(loadId: string, snapshot: LoadAlertSnapshot): LoadSummary {
  return {
    loadId,
    loadCode: snapshot.code,
    vehicleNo: snapshot.vehicleNumber,
    route: snapshot.route,
    transporterName: snapshot.transporterName,
    consignee: snapshot.consigneeName,
  };
}

/** The transporter's advance in rupees — same formula as load-payment.service.ts's
 *  computeShareAmount. Null when the load has no agreed freight yet. */
function advanceAmountOf(snapshot: LoadAlertSnapshot, advancePercentage: number): string | null {
  if (snapshot.freightValue == null) return null;
  const freightValue = Number(snapshot.freightValue);
  const freightTotal =
    snapshot.freightType === 'flat'
      ? freightValue
      : freightValue * Number(snapshot.plannedCapacityTonnes ?? 0);
  return formatRupees((freightTotal * advancePercentage) / 100);
}

/** The reporting time as the messages show it ("17 Oct, 10:00"), or null without a pickup. */
function reportingTimeOf(pickupAt: Date | null, pickupDate: string | null): string | null {
  const reportingAt = reportingAtOf(pickupAt, pickupDate);
  return reportingAt ? formatIndiaDateTime(reportingAt) : null;
}

/** Context resolvers for the trigger worker (wired in composition-root.ts). `checkCompliance` is
 *  the loads module's assignment-time check (AssignmentComplianceService.check) — LS_N_0017 re-runs
 *  it to tell whether the expired document has been renewed. `tracking` supplies the live ETA
 *  for LS_N_0025/0026/0027; `haltGeofences` the geofences LS_N_0027 checks a halt against. */
export function createLoadAlertResolvers(
  loadAlertRepository: LoadAlertRepository,
  checkCompliance: (tenantId: string, target: AssignmentTarget) => Promise<AssignmentCompliance>,
  tracking: TrackingClient,
  haltGeofences: HaltGeofences,
) {
  return {
    /** LS_N_0025 — null once the truck has reached the delivery point (or later), its bill was
     *  regenerated (a newer alert is queued for that one), or tracking projects it to arrive
     *  before the expiry. No ETA from tracking, or a stale one, still sends — the risk isn't ruled
     *  out. */
    ewayBillExpiry: async (
      tenantId: string,
      context: EwayBillExpiryContext,
    ): Promise<EwayBillExpiryContext | null> => {
      const snapshot = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
      if (!snapshot || ARRIVED_AT_DELIVERY_STATUSES.includes(snapshot.status as LoadStatus))
        return null;
      if (snapshot.ewayBillGeneratedAt?.toISOString() !== context.generatedAt) return null;
      const eta = await tracking.getTripEta(tenantId, context.loadId);
      // A stale ETA (no GPS for 60+ min) is the last one computed, not a live projection — a
      // halted truck arrives later than it says — so it can't rule the risk out either.
      const liveEta = eta && !eta.stale ? eta : null;
      if (liveEta && liveEta.etaAt.getTime() <= new Date(context.expiresAt).getTime()) return null;
      return {
        ...context,
        ...summaryOf(context.loadId, snapshot),
        ewayBillNumber: snapshot.ewayBillNumber,
        destination: snapshot.destinationCity,
        etaAt: liveEta?.etaAt.toISOString() ?? null,
      };
    },

    /** LS_N_0024 — the load's documents and cargo, and who confirmed loading. */
    vehicleLoaded: async (
      tenantId: string,
      context: VehicleLoadedContext,
    ): Promise<VehicleLoadedContext | null> => {
      const snapshot = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
      if (!snapshot) return null;
      return {
        ...context,
        ...summaryOf(context.loadId, snapshot),
        origin: snapshot.originCity,
        confirmedByName:
          (await loadAlertRepository.findPersonName(context.confirmedBy)) ??
          ('driverId' in context.confirmedBy ? snapshot.driverName : null),
        cargoTonnes: snapshot.cargoTonnes,
        documentCount: snapshot.documentCount,
        elrNumber: snapshot.elrNumber,
        hasLorryReceipt: snapshot.hasLorryReceipt,
        ewayBillNumber: snapshot.ewayBillNumber,
      };
    },

    /** LS_N_0021 — null once the vehicle has reached the plant (the load left "assigned") or this
     *  step already went out. "Last seen" is tracking's last position, when it has one. */
    vehicleNotReported: async (
      tenantId: string,
      context: VehicleNotReportedContext,
    ): Promise<VehicleNotReportedContext | null> => {
      const snapshot = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
      if (!snapshot || snapshot.status !== 'assigned') return null;
      if (
        await loadAlertRepository.hasSentNotification(tenantId, 'load.vehicle_not_reported', {
          load_id: context.loadId,
          ladder_step: String(context.step),
        })
      ) {
        return null;
      }
      const { position } = await tracking.getTrip(tenantId, context.loadId);
      const hasOrigin = snapshot.originLat != null && snapshot.originLng != null;
      return {
        ...context,
        ...summaryOf(context.loadId, snapshot),
        origin: snapshot.originCity,
        driverName: snapshot.driverName,
        driverPhone: snapshot.driverPhone,
        isOwnFleet: snapshot.sourceType === 'own_fleet',
        createdBy: snapshot.createdBy,
        lateMinutes: (Date.now() - new Date(context.reportingAt).getTime()) / MS_PER_MINUTE,
        lastSeenPlace: position?.placeName ?? null,
        distanceAwayKm:
          position && hasOrigin
            ? distanceKmBetween(position, { lat: snapshot.originLat!, lng: snapshot.originLng! })
            : null,
      };
    },

    /** LS_N_0022 — early/late against the reporting time, and when the free loading time ends. */
    vehicleReachedPickup: async (
      tenantId: string,
      context: VehicleReachedPickupContext,
    ): Promise<VehicleReachedPickupContext | null> => {
      const snapshot = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
      if (!snapshot) return null;
      const reportingAt = reportingAtOf(snapshot.pickupAt, snapshot.pickupDate);
      const { loadingFreeHours } = await loadAlertRepository.findDetentionTerms(tenantId);
      return {
        ...context,
        ...summaryOf(context.loadId, snapshot),
        origin: snapshot.originCity,
        reportingAt: reportingAt?.toISOString() ?? null,
        freeTimeEndsAt: new Date(
          new Date(context.arrivedAt).getTime() + loadingFreeHours * MS_PER_HOUR,
        ).toISOString(),
      };
    },

    /** LS_N_0023 — null once the vehicle has left the loading point or this step already went
     *  out. Left means: out of the geofence (tracking moved the load to "In transit") when the
     *  geofence saw it arrive; loading confirmed when its arrival was tapped by hand (no exit to
     *  wait for). The amount is the hours beyond the free time × the rate. */
    detentionAtLoading: async (
      tenantId: string,
      context: DetentionAtLoadingContext,
    ): Promise<DetentionAtLoadingContext | null> => {
      const snapshot = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
      if (!snapshot?.atPlantAt) return null;
      const stillAtOrigin =
        snapshot.status === 'at_plant' ||
        (snapshot.status === 'loading_confirmed' &&
          (await loadAlertRepository.arrivedByTracking(tenantId, context.loadId, 'at_plant')));
      if (!stillAtOrigin) return null;
      if (
        await loadAlertRepository.hasSentNotification(tenantId, 'load.detention_at_loading', {
          load_id: context.loadId,
          ladder_step: String(context.step),
        })
      ) {
        return null;
      }
      const { loadingFreeHours, ratePerHour } =
        await loadAlertRepository.findDetentionTerms(tenantId);
      const hoursAtOrigin = (Date.now() - snapshot.atPlantAt.getTime()) / MS_PER_HOUR;
      return {
        ...context,
        ...summaryOf(context.loadId, snapshot),
        origin: snapshot.originCity,
        hoursAtOrigin: Math.floor(hoursAtOrigin),
        freeHours: loadingFreeHours,
        amount: formatRupees(Math.max(0, hoursAtOrigin - loadingFreeHours) * ratePerHour),
        ratePerHour: formatRupees(ratePerHour),
      };
    },

    /** LS_N_0031 — early/late against the promised delivery date (the end of that day), and when
     *  the free unloading time ends (the customer's free hours at drop, else the company's). */
    vehicleReachedDrop: async (
      tenantId: string,
      context: VehicleReachedDropContext,
    ): Promise<VehicleReachedDropContext | null> => {
      const snapshot = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
      if (!snapshot) return null;
      const terms = await loadAlertRepository.findDetentionTerms(tenantId);
      const freeHours = snapshot.customerFreeHoursAtDrop ?? terms.unloadingFreeHours;
      return {
        ...context,
        ...summaryOf(context.loadId, snapshot),
        promisedAt: promisedAtOf(snapshot.promisedDeliveryDate)?.toISOString() ?? null,
        freeTimeEndsAt: new Date(
          new Date(context.arrivedAt).getTime() + freeHours * MS_PER_HOUR,
        ).toISOString(),
      };
    },

    /** LS_N_0032 — null once the vehicle has left the delivery point or this step already went
     *  out. Left means: out of the geofence (tracking's exit) when the geofence saw it arrive —
     *  for as long as tracking follows a delivered load; the E-POD when its arrival was tapped by
     *  hand (no exit to wait for). Same rule as findUnloadingDetentionCandidates. */
    detentionAtUnloading: async (
      tenantId: string,
      context: DetentionAtUnloadingContext,
    ): Promise<DetentionAtUnloadingContext | null> => {
      const snapshot = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
      if (!snapshot?.reachedDeliveryPointAt || snapshot.departedDropAt) return null;
      const stillAtDestination =
        snapshot.status === 'reached_delivery_point' ||
        ((snapshot.status === 'delivered' || snapshot.status === 'closed') &&
          !!snapshot.deliveredAt &&
          Date.now() - snapshot.deliveredAt.getTime() < TRIP_COMPLETED_FALLBACK_MS &&
          (await loadAlertRepository.arrivedByTracking(
            tenantId,
            context.loadId,
            'reached_delivery_point',
          )));
      if (!stillAtDestination) return null;
      if (
        await loadAlertRepository.hasSentNotification(tenantId, 'load.detention_at_unloading', {
          load_id: context.loadId,
          ladder_step: String(context.step),
        })
      ) {
        return null;
      }
      const terms = await loadAlertRepository.findDetentionTerms(tenantId);
      const freeHours = snapshot.customerFreeHoursAtDrop ?? terms.unloadingFreeHours;
      const hoursAtDestination =
        (Date.now() - snapshot.reachedDeliveryPointAt.getTime()) / MS_PER_HOUR;
      return {
        ...context,
        ...summaryOf(context.loadId, snapshot),
        destination: snapshot.destinationCity,
        hoursAtDestination: Math.floor(hoursAtDestination),
        freeHours,
        amount: formatRupees(Math.max(0, hoursAtDestination - freeHours) * terms.ratePerHour),
      };
    },

    /** LS_N_0033 — once unloading is confirmed (E-POD in) and the vehicle has left the delivery
     *  point. When the geofence saw it arrive, that's tracking's exit (departedDropAt) — the
     *  post-E-POD retry (`fallback`) completes it anyway if the exit never came; a manual arrival
     *  has no exit to wait for. Once per trip (the catalog dedupes on the load). */
    tripCompleted: async (
      tenantId: string,
      context: TripCompletedContext,
    ): Promise<TripCompletedContext | null> => {
      const snapshot = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
      if (!snapshot || (snapshot.status !== 'delivered' && snapshot.status !== 'closed')) {
        return null;
      }
      if (
        !snapshot.departedDropAt &&
        !context.fallback &&
        (await loadAlertRepository.arrivedByTracking(
          tenantId,
          context.loadId,
          'reached_delivery_point',
        ))
      ) {
        return null; // tracking's exit from the delivery point completes it
      }
      return {
        ...context,
        ...summaryOf(context.loadId, snapshot),
        createdBy: snapshot.createdBy,
        quantityTonnes: snapshot.podQuantityReceived,
        departedAt: snapshot.departedDropAt?.toISOString() ?? null,
      };
    },

    /** LS_N_0026 — null once the truck has already reached the delivery point (a late or
     *  replayed tracking event). ETA and km left come from tracking when it has them. */
    vehicleInTransit: async (
      tenantId: string,
      context: VehicleInTransitContext,
    ): Promise<VehicleInTransitContext | null> => {
      const snapshot = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
      if (!snapshot || ARRIVED_AT_DELIVERY_STATUSES.includes(snapshot.status as LoadStatus))
        return null;
      const eta = await tracking.getTripEta(tenantId, context.loadId);
      return {
        ...context,
        ...summaryOf(context.loadId, snapshot),
        origin: snapshot.originCity,
        destination: snapshot.destinationCity,
        etaAt: eta?.etaAt.toISOString() ?? null,
        remainingKm: eta?.remainingKm ?? null,
      };
    },

    /** LS_N_0027 — sends only if, at this step (2 h / 6 h into the halt), the load is still in
     *  transit, this step hasn't gone out, the truck is still standing where it stopped (a fresh
     *  position within VEHICLE_HALT_SAME_SPOT_M of the halt anchor), the spot isn't an expected
     *  stop (origin / destination / rest stop / toll plaza geofence — halt-exclusions.ts) and
     *  tracking's live ETA is behind the promised time. No ETA, or a stale one, can't show the
     *  risk, so nothing is sent. */
    vehicleHalted: async (
      tenantId: string,
      context: VehicleHaltedContext,
    ): Promise<VehicleHaltedContext | null> => {
      const skip = (reason: string) => {
        console.debug(
          `LS_N_0027 skipped for load ${context.loadId} (${context.step}, halt ${context.haltAlertId}): ${reason}`,
        );
        return null;
      };
      const snapshot = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
      if (!snapshot || snapshot.status !== 'in_transit') return skip('load not in transit');
      if (
        await loadAlertRepository.hasSentNotification(tenantId, 'load.vehicle_halted', {
          load_id: context.loadId,
          halt_alert_id: context.haltAlertId,
          halt_step: context.step,
        })
      ) {
        return skip('already sent');
      }

      const anchor = { lat: context.anchorLat, lng: context.anchorLng };
      const { eta, position } = await tracking.getTrip(tenantId, context.loadId);
      if (
        !position ||
        position.stale ||
        distanceMetresBetween(anchor, position) > VEHICLE_HALT_SAME_SPOT_M
      ) {
        return skip('halt over or no fresh position');
      }

      const exclusion = await findHaltExclusion({
        tenantId,
        anchor,
        origin: {
          loadingPointId: snapshot.originLoadingPointId,
          customerDeliveryPointId: null,
          pin:
            snapshot.originLat != null && snapshot.originLng != null
              ? {
                  lat: snapshot.originLat,
                  lng: snapshot.originLng,
                  radiusM: snapshot.originGeofenceRadiusM,
                }
              : null,
        },
        destination: {
          loadingPointId: snapshot.destinationLoadingPointId,
          customerDeliveryPointId: snapshot.destinationDeliveryPointId,
          pin:
            snapshot.destinationLat != null && snapshot.destinationLng != null
              ? {
                  lat: snapshot.destinationLat,
                  lng: snapshot.destinationLng,
                  radiusM: snapshot.destinationGeofenceRadiusM,
                }
              : null,
        },
        trackingStopPlaceKind: context.stopPlaceKind ?? null,
        geofences: haltGeofences,
      });
      if (exclusion) return skip(`expected stop (${exclusion.kind})`);

      if (!eta || eta.stale || eta.projectedDelayMin == null || eta.projectedDelayMin <= 0) {
        return skip('ETA not at risk');
      }

      return {
        ...context,
        ...summaryOf(context.loadId, snapshot),
        location: position.placeName ?? `${position.lat.toFixed(4)}, ${position.lng.toFixed(4)}`,
        destination: snapshot.destinationCity,
        revisedEtaAt: eta.etaAt.toISOString(),
        delayMin: eta.projectedDelayMin,
        haltDurationMin: (Date.now() - new Date(context.haltStartedAt).getTime()) / MS_PER_MINUTE,
        driverName: snapshot.driverName,
        driverPhone: snapshot.driverPhone,
      };
    },

    /** LS_N_0028 — tracking already judged the deviation (far, long, heading away); null once
     *  the load is no longer in transit. Fills in where the truck is and the live ETA. */
    routeDeviation: async (
      tenantId: string,
      context: RouteDeviationContext,
    ): Promise<RouteDeviationContext | null> => {
      const snapshot = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
      if (!snapshot || snapshot.status !== 'in_transit') return null;
      const { eta, position } = await tracking.getTrip(tenantId, context.loadId);
      return {
        ...context,
        ...summaryOf(context.loadId, snapshot),
        location: position?.placeName ?? `${context.lat.toFixed(4)}, ${context.lng.toFixed(4)}`,
        revisedEtaAt: eta && !eta.stale ? eta.etaAt.toISOString() : null,
        deviationDurationMin:
          (Date.now() - new Date(context.deviationStartedAt).getTime()) / MS_PER_MINUTE,
        driverName: snapshot.driverName,
        driverPhone: snapshot.driverPhone,
      };
    },

    /** LS_N_0029 — null once the trip isn't running any more (delivered/closed, or back before
     *  At plant) or a newer position has come in since tracking sent the notice. */
    trackingSignalLost: async (
      tenantId: string,
      context: TrackingSignalLostContext,
    ): Promise<TrackingSignalLostContext | null> => {
      const snapshot = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
      if (!snapshot || !SIGNAL_WATCHED_STATUSES.includes(snapshot.status)) return null;
      const lastSeenMs = new Date(context.lastSeenAt).getTime();
      const { position } = await tracking.getTrip(tenantId, context.loadId);
      if (position && position.recordedAt.getTime() > lastSeenMs + MS_PER_MINUTE) return null;
      const known = context.lastLat != null && context.lastLng != null;
      return {
        ...context,
        ...summaryOf(context.loadId, snapshot),
        lastLocation: known
          ? (position?.placeName ??
            `${context.lastLat!.toFixed(4)}, ${context.lastLng!.toFixed(4)}`)
          : null,
        hoursSince: Math.floor((Date.now() - lastSeenMs) / MS_PER_HOUR),
        destination: snapshot.destinationCity,
        driverName: snapshot.driverName,
        driverPhone: snapshot.driverPhone,
      };
    },

    /** LS_N_0030 — null once the load is no longer in transit. A fresher ETA from tracking, when
     *  it has one, replaces the one in the notice; the load's creator is added as a recipient. */
    deliveryLate: async (
      tenantId: string,
      context: DeliveryLateContext,
    ): Promise<DeliveryLateContext | null> => {
      const snapshot = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
      if (!snapshot || snapshot.status !== 'in_transit') return null;
      const eta = await tracking.getTripEta(tenantId, context.loadId);
      const fresh = eta && !eta.stale && eta.projectedDelayMin != null;
      return {
        ...context,
        ...summaryOf(context.loadId, snapshot),
        etaAt: fresh ? eta.etaAt.toISOString() : context.etaAt,
        delayMin: fresh ? Math.max(context.delayMin, eta.projectedDelayMin!) : context.delayMin,
        destination: snapshot.destinationCity,
        createdBy: snapshot.createdBy,
      };
    },

    /** Null once the E-POD is no longer waiting for review. */
    podUploaded: async (
      tenantId: string,
      context: PodUploadedContext,
    ): Promise<PodUploadedContext | null> => {
      const snapshot = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
      if (!snapshot || snapshot.podStatus !== 'pending') return null;
      return {
        ...context,
        ...summaryOf(context.loadId, snapshot),
        receiverName: snapshot.podReceiverName,
        quantityReceived: snapshot.podQuantityReceived,
        tonnesShort: snapshot.numberOfTonnesShort,
        shortageOrDamage: snapshot.shortageOrDamage,
      };
    },

    /** Null for own-fleet loads, no advance share, or an advance already paid. */
    advanceDue: async (
      tenantId: string,
      context: AdvanceDueContext,
    ): Promise<AdvanceDueContext | null> => {
      const snapshot = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
      const advancePercentage = Number(snapshot?.advancePercentage ?? 0);
      if (
        !snapshot ||
        snapshot.sourceType === 'own_fleet' ||
        snapshot.advancePaidAt ||
        advancePercentage <= 0
      ) {
        return null;
      }
      const bankCode = snapshot.transporterBankIfsc?.slice(0, 4).toUpperCase() ?? null;
      return {
        ...context,
        ...summaryOf(context.loadId, snapshot),
        advancePercentage: snapshot.advancePercentage,
        amount: advanceAmountOf(snapshot, advancePercentage),
        bankName: bankCode ? (BANK_NAME_BY_IFSC_PREFIX[bankCode] ?? bankCode) : null,
        accountLast4: snapshot.transporterBankAccountNumber?.slice(-4) ?? null,
      };
    },

    /** LS_N_0016 — the load's vehicle, driver, origin and pickup at send time. */
    vehicleAssigned: async (
      tenantId: string,
      context: VehicleAssignedContext,
    ): Promise<VehicleAssignedContext | null> => {
      const snapshot = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
      if (!snapshot || !snapshot.vehicleNumber) return null;
      return {
        ...context,
        ...summaryOf(context.loadId, snapshot),
        isOwnFleet: snapshot.sourceType === 'own_fleet',
        driverName: snapshot.driverName,
        driverPhone: snapshot.driverPhone,
        origin: snapshot.originCity,
        reportingTime: reportingTimeOf(snapshot.pickupAt, snapshot.pickupDate),
        createdBy: snapshot.createdBy,
      };
    },

    /** LS_N_0017 — null once the expired document is renewed. The first send is skipped if the
     *  same blocked assignment already alerted within the hour (a user retrying); the 60-minute
     *  escalation is skipped once the load / requisition has been given another vehicle. */
    assignmentComplianceFailed: async (
      tenantId: string,
      context: AssignmentComplianceFailedContext & { isReminder?: boolean },
    ): Promise<AssignmentComplianceFailedContext | null> => {
      const { failure } = await checkCompliance(
        tenantId,
        context.subject === 'vehicle'
          ? { vehicleId: context.vehicleId }
          : { driverId: context.driverId },
      );
      if (!failure) return null;

      const blockedAt = new Date(context.blockedAt);
      if (context.isReminder) {
        if (context.loadId) {
          const load = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
          if (!load || load.status !== 'created') return null;
        } else if (
          context.requisitionId &&
          (await loadAlertRepository.hasLoadOnRequisitionSince(
            tenantId,
            context.requisitionId,
            blockedAt,
          ))
        ) {
          return null;
        }
      } else if (
        await loadAlertRepository.hasSentNotification(
          tenantId,
          'load.assignment_compliance_failed',
          { block_key: assignmentBlockKeyOf(context), ladder_step: 'initial' },
          new Date(Date.now() - ASSIGNMENT_BLOCK_ALERT_WINDOW_MS),
        )
      ) {
        return null;
      }

      if (context.loadId) {
        const load = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
        return {
          ...context,
          referenceCode: load?.code ?? null,
          route: load?.route ?? null,
          origin: load?.originCity ?? null,
          reportingTime: load ? reportingTimeOf(load.pickupAt, load.pickupDate) : null,
        };
      }
      if (context.requisitionId) {
        const requisition = await loadAlertRepository.findRequisitionSummary(
          tenantId,
          context.requisitionId,
        );
        return {
          ...context,
          referenceCode: requisition?.code ?? null,
          route: requisition?.route ?? null,
          reportingTime: requisition ? reportingTimeOf(null, requisition.pickupDate) : null,
        };
      }
      return {
        ...context,
        route:
          context.origin && context.destination
            ? `${context.origin} to ${context.destination}`
            : null,
        reportingTime: reportingTimeOf(context.pickupAt ? new Date(context.pickupAt) : null, null),
      };
    },
  };
}
