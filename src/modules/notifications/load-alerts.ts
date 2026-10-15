import { NotificationTriggers } from './notification-triggers';
import {
  AdvanceDueContext,
  EwayBillExpiryContext,
  LoadStageContext,
  LoadSummary,
  PodUploadedContext,
} from './catalog/notification-catalog';
import { LoadAlertRepository } from './load-alert.repository';
import { BANK_NAME_BY_IFSC_PREFIX, EWAY_BILL_ALERT_LEAD_MS } from './notifications.constants';
import { LoadAlertSnapshot, LoadEventNotifier } from './notifications.interface';

/**
 * Load-event notifications: trip stage handoffs, e-way bill expiry, E-POD uploaded and advance
 * due. LoadService calls the notifier after its own writes — it only queues ids and never throws
 * (same contract as breakdown-alerts.ts); the trigger worker's resolvers below then read
 * everything the message needs, and return null (nothing sent) once it no longer applies.
 */
export function createLoadEventNotifier(triggers: NotificationTriggers): LoadEventNotifier {
  return async (event) => {
    const { tenantId, loadId } = event;
    try {
      switch (event.kind) {
        case 'in_transit':
        case 'reached_delivery_point':
          await triggers.enqueue('load.stage_handoff', tenantId, {
            loadId,
            stage: event.kind,
            at: event.at.toISOString(),
          });
          // Loading confirmed is when an advance can first be recorded; the resolver drops it
          // for own-fleet loads, no advance share, or an advance already paid.
          if (event.kind === 'in_transit') {
            await triggers.enqueue('load.advance_due', tenantId, { loadId });
          }
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
      }
    } catch (error) {
      console.warn(`Failed to queue ${event.kind} notification for load ${loadId}`, error);
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

/** Context resolvers for the trigger worker (wired in composition-root.ts). */
export function createLoadAlertResolvers(loadAlertRepository: LoadAlertRepository) {
  return {
    stageHandoff: async (
      tenantId: string,
      context: LoadStageContext,
    ): Promise<LoadStageContext | null> => {
      const snapshot = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
      return snapshot ? { ...context, ...summaryOf(context.loadId, snapshot) } : null;
    },

    /** Null once the load is delivered/closed or its bill was regenerated (a newer alert is
     *  queued for that one). */
    ewayBillExpiry: async (
      tenantId: string,
      context: EwayBillExpiryContext,
    ): Promise<EwayBillExpiryContext | null> => {
      const snapshot = await loadAlertRepository.findSnapshot(tenantId, context.loadId);
      if (!snapshot || snapshot.status === 'delivered' || snapshot.status === 'closed') {
        return null;
      }
      if (snapshot.ewayBillGeneratedAt?.toISOString() !== context.generatedAt) return null;
      return {
        ...context,
        ...summaryOf(context.loadId, snapshot),
        ewayBillNumber: snapshot.ewayBillNumber,
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
  };
}
