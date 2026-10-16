import { NotificationTriggers } from './notification-triggers';
import type { TrackingClient } from '../../adapters/tracking.client';
import type { AssignmentCompliance, AssignmentTarget } from '../loads/utils/load.interface';
import { ARRIVED_AT_DELIVERY_STATUSES, LoadStatus } from '../loads/utils/loads.types';
import {
  AdvanceDueContext,
  AssignmentComplianceFailedContext,
  assignmentBlockKeyOf,
  EwayBillExpiryContext,
  LoadStageContext,
  LoadSummary,
  PodUploadedContext,
  VehicleAssignedContext,
  DetentionAtLoadingContext,
  VehicleInTransitContext,
  VehicleLoadedContext,
  VehicleNotReportedContext,
  VehicleReachedPickupContext,
} from './catalog/notification-catalog';
import { LoadAlertRepository } from './load-alert.repository';
import {
  ASSIGNMENT_BLOCK_ALERT_WINDOW_MS,
  BANK_NAME_BY_IFSC_PREFIX,
  DETENTION_RATE_PER_HOUR,
  EWAY_BILL_ALERT_LEAD_MS,
  FREE_LOADING_HOURS,
  MS_PER_HOUR,
  MS_PER_MINUTE,
} from './notifications.constants';
import { LoadAlertSnapshot, LoadEventNotifier } from './notifications.interface';
import { distanceKmBetween, formatIndiaDateTime, reportingAtOf } from './utils/trip-time';

/**
 * Load-event notifications: reached delivery (stage handoff), e-way bill expiry (LS_N_0025), E-POD
 * uploaded, advance due, truck assigned (LS_N_0016), assignment blocked on compliance (LS_N_0017)
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
          await triggers.enqueue('load.stage_handoff', tenantId, {
            loadId,
            stage: event.kind,
            at: event.at.toISOString(),
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
 *  for LS_N_0025/0026. */
export function createLoadAlertResolvers(
  loadAlertRepository: LoadAlertRepository,
  checkCompliance: (tenantId: string, target: AssignmentTarget) => Promise<AssignmentCompliance>,
  tracking: TrackingClient,
) {
  return {
    stageHandoff: async (
      tenantId: string,
      context: LoadStageContext,
    ): Promise<LoadStageContext | null> => {
      const snapshot = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
      return snapshot ? { ...context, ...summaryOf(context.loadId, snapshot) } : null;
    },

    /** LS_N_0025 — null once the truck has reached the delivery point (or later), its bill was
     *  regenerated (a newer alert is queued for that one), or tracking projects it to arrive
     *  before the expiry. No ETA from tracking still sends — the risk isn't ruled out. */
    ewayBillExpiry: async (
      tenantId: string,
      context: EwayBillExpiryContext,
    ): Promise<EwayBillExpiryContext | null> => {
      const snapshot = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
      if (!snapshot || ARRIVED_AT_DELIVERY_STATUSES.includes(snapshot.status as LoadStatus))
        return null;
      if (snapshot.ewayBillGeneratedAt?.toISOString() !== context.generatedAt) return null;
      const eta = await tracking.getTripEta(tenantId, context.loadId);
      if (eta && eta.etaAt.getTime() <= new Date(context.expiresAt).getTime()) return null;
      return {
        ...context,
        ...summaryOf(context.loadId, snapshot),
        ewayBillNumber: snapshot.ewayBillNumber,
        destination: snapshot.destinationCity,
        etaAt: eta?.etaAt.toISOString() ?? null,
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
      return {
        ...context,
        ...summaryOf(context.loadId, snapshot),
        origin: snapshot.originCity,
        reportingAt: reportingAt?.toISOString() ?? null,
        freeTimeEndsAt: new Date(
          new Date(context.arrivedAt).getTime() + FREE_LOADING_HOURS * MS_PER_HOUR,
        ).toISOString(),
      };
    },

    /** LS_N_0023 — null once the vehicle has left "At plant" (loading confirmed) or this step
     *  already went out. The amount is the hours beyond the free time × the rate. */
    detentionAtLoading: async (
      tenantId: string,
      context: DetentionAtLoadingContext,
    ): Promise<DetentionAtLoadingContext | null> => {
      const snapshot = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
      if (!snapshot || snapshot.status !== 'at_plant' || !snapshot.atPlantAt) return null;
      if (
        await loadAlertRepository.hasSentNotification(tenantId, 'load.detention_at_loading', {
          load_id: context.loadId,
          ladder_step: String(context.step),
        })
      ) {
        return null;
      }
      const hoursAtOrigin = (Date.now() - snapshot.atPlantAt.getTime()) / MS_PER_HOUR;
      return {
        ...context,
        ...summaryOf(context.loadId, snapshot),
        origin: snapshot.originCity,
        hoursAtOrigin: Math.floor(hoursAtOrigin),
        freeHours: FREE_LOADING_HOURS,
        amount: formatRupees(
          Math.max(0, hoursAtOrigin - FREE_LOADING_HOURS) * DETENTION_RATE_PER_HOUR,
        ),
        ratePerHour: formatRupees(DETENTION_RATE_PER_HOUR),
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
