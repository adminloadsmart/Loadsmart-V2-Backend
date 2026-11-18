import { withoutDriverPay } from '../../driver/driver.service';
import { MASTERS_WRITE } from '../../../shared/constants/permissions';
import {
  hasPermission,
  PermissionHolder,
} from '../../../shared/middleware/require-permission.middleware';
import { LoadDocumentService } from '../documents/load-document.service';
import { DocumentActor } from '../documents/load-document.types';
import { decideStage } from './stage-rules';
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
  rethrow,
} from '../../../shared/errors';
import { humanizeStatus } from '../../../shared/utils/humanize';
import { AuditService } from '../../audit/audit.service';
import { AuthService, FleetOwnerDetails } from '../../auth/auth.service';
import {
  TransporterService,
  withoutTransporterBank,
} from '../../masters/transporter/transporter.service';
import { StorageService } from '../../storage/storage.service';
import { msg } from '../../../shared/i18n/translate';
import { redisManager } from '../../../db/redis';
import { MAX_OTP_ATTEMPTS } from '../../auth/auth.constants';
import { paginate, Paginated, PaginationInput } from '../../../shared/utils/pagination';
import { LoadRepository, UpdateLoadData, LoadListCounts } from './load.repository';
import type {
  PodCardLoad,
  PodCardLoadRef,
  TripCardLoad,
  TripCardRef,
} from '../../driver/portal/driver-portal.types';
import { LoadPaymentRepository } from '../payments/load-payment.repository';
import { LoadIssueRepository } from '../issues/load-issue.repository';
import { LoadActivityService } from '../activity/load-activity.service';
import { LoadStageService } from './load-stage.service';
import { LoadEntity } from '../entities/load.entity';
import { LoadPaymentEntity } from '../entities/load-payment.entity';
import { LoadIssueReportEntity } from '../entities/load-issue-report.entity';
import {
  COMPLETED_LOAD_STATUSES,
  MANUAL_MARK_TRIGGERS,
  podDecisionTrigger,
  UNLOADED_LOAD_STATUSES,
  ManualTrackingStatus,
  LoadStatus,
  ShortageOrDamageStatus,
} from '../utils/loads.types';
import { hasLoadingPapers, progressPercentFor } from '../utils/load-stages';
import { decodeLiveLoadsCursor, encodeLiveLoadsCursor } from '../utils/live-loads-cursor';
import { LoadActivityWithActor, LoadAssignedBy } from '../utils/load-activity.interface';
import { ReportLoadIssueInput } from '../utils/load-issue.interface';
import {
  AssignLoadInput,
  ConfirmLoadingInput,
  EwayBillExpiry,
  ListLiveLoadsInput,
  ListLoadsInput,
  SetLoadingContactInput,
  SetLoadingPointInput,
  UploadPodInput,
  ReviewPodInput,
  TransporterInvoiceInput,
  UnloadingDetailsInput,
  IssueDeductionInput,
} from '../utils/load.interface';
import {
  LoadEventNotifier,
  IssueReportedNotifier,
} from '../../notifications/notifications.interface';
import { DriverMessage } from '../../notifications/notifications.types';
import {
  AssignmentComplianceService,
  assignmentBlockedError,
  vehicleDocumentWarning,
  assignmentBlockedEvent,
} from '../compliance/assignment-compliance.service';
import {
  buildNextAction,
  buildStepper,
  LoadPapers,
  toLoadPapers,
  toTripDoneDetail,
  toTripListRow,
  TripDoneDetail,
  TripAssignment,
  TripListRow,
  TripNextAction,
  TripStepperStep,
  TripIncident,
  buildIncident,
  AmountDue,
} from '../utils/trip-view';
import { DEFAULT_LOCALE, Locale } from '../../../shared/i18n/locales';
import { DriverTripNotifier } from '../utils/load-alert.interface';
import {
  DRIVER_LOADING_CONTACT_CHANGED_NOTIFICATION_TYPE,
  DRIVER_LOADING_POINT_CHANGED_NOTIFICATION_TYPE,
} from '../../driver/driver.constants';

const EWAY_BILL_VALIDITY_MS = 2 * 60 * 60 * 1000; // 2-hour expiry alert

export interface ListTripsResult extends Paginated<TripListRow> {
  /** Tab counts for the whole tenant (scoped by the same non-group filters as the list itself),
   *  independent of which `group` — if any — the caller requested. */
  counts: LoadListCounts;
}

/** Home Live Loads row — a trips-list row plus how far along its route the load is. */
export interface LiveLoadRow extends TripListRow {
  progressPercent: number;
}

/** One scroll page of Home Live Loads. Pass `nextCursor` back as `cursor` for the next page;
 *  it is null once `hasMore` is false. */
export interface ListLiveLoadsResult {
  items: LiveLoadRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Driver-app "Trips Done" screen — a dedicated, always-completed-only view of a single driver's
 *  own trip history, separate from the general list() above (which serves the tenant-wide Trips
 *  Home page and accepts arbitrary status/group/postingType/route filters). See
 *  driver-portal.controller.ts's getMyTripsDone. Amount/paid and per-trip distance are
 *  deliberately not here yet — own-fleet loads (what every driver-app caller has) carry no
 *  driver-payout amount anywhere in this build, and there's no distance-capture point wired up
 *  yet either; both are follow-up work. */
export interface TripsDoneResult extends Paginated<TripListRow> {
  totalTrips: number;
  /** Percentage (0-100) of completed trips with a confirmed E-POD on file. */
  epodVerifiedPercentage: number;
}

/** Raw storage keys for a load's documents — `load` carries these same fields as download URLs. */
export interface LoadDocumentKeys {
  invoiceFileKey: string | null;
  ewayBillFileKey: string | null;
  elrFileKey: string | null;
  podFileKey: string | null;
  podBackFileKey: string | null;
  weighingSlipFileKey: string | null;
  loadingPhotoFileKeys: string[] | null;
  /** The assigned driver's driving licence photos (masters.driver_documents). */
  dlFrontKey: string | null;
  dlBackKey: string | null;
}

export interface LoadDetailView {
  /** Document fields as download URLs, plus the assigned driver's licence photo URLs. */
  load: LoadEntity & { dlFrontKey: string | null; dlBackKey: string | null };
  ownerPhoneNumber: string | null;
  dispatchPhoneNumber: string | null;
  /** The fleet owner (org admin) and dispatch contact behind this load. */
  fleetOwner: FleetOwnerDetails;
  /** Who assigned the truck; null while none is assigned or when the system did. */
  assignedBy: LoadAssignedBy | null;
  documentKeys: LoadDocumentKeys;
  timeline: LoadActivityWithActor[];
  payments: LoadPaymentEntity[];
  ewayBillExpiry: EwayBillExpiry;
  stepper: TripStepperStep[];
  nextAction: TripNextAction;
  /** Newest unresolved driver-reported issue, or null. `incident.halted` means the trip is on hold. */
  incident: TripIncident | null;
}

// TEMPORARY: the receiver code is a fixed value until a real SMS template/provider is wired in —
// no SMS is sent. Replace sendPodReceiverCode's no-op and the check in uploadPod together.
const POD_RECEIVER_STATIC_OTP = '1234';
/** How long a verified receiver number stays valid for the final E-POD submit. */
const POD_RECEIVER_VERIFIED_TTL_SECONDS = 30 * 60;
const podReceiverVerifiedKey = (loadId: string, mobile: string) =>
  `pod-receiver-verified:${loadId}:${mobile}`;
const podReceiverAttemptsKey = (loadId: string, mobile: string) =>
  `pod-receiver-attempts:${loadId}:${mobile}`;

/** A Loadsmart load's delivery issue is settled through its claim (claim value, then settle —
 *  loadsmart-ops LsShipperService), never directly; that path passes `viaClaim`. */
function assertNotLoadsmartClaim(load: LoadEntity, viaClaim: boolean): void {
  if (load.route === 'loadsmart' && !viaClaim) {
    throw new ConflictError('On a Loadsmart load, settle the claim instead');
  }
}

/** Who a document upload came from: the driver app (the actor is the driver) or a user. */
function documentActor(actorId: string, driverOwnerId?: string, console = false): DocumentActor {
  if (console) return { userId: actorId, source: 'console' };
  return driverOwnerId
    ? { userId: null, driverId: actorId, source: 'driver_app' }
    : { userId: actorId, source: 'web' };
}

export class LoadService {
  constructor(
    private readonly repository: LoadRepository,
    private readonly authService: AuthService,
    private readonly loadPaymentRepository: LoadPaymentRepository,
    private readonly loadIssueRepository: LoadIssueRepository,
    private readonly transporterService: TransporterService,
    private readonly storageService: StorageService,
    private readonly loadActivityService: LoadActivityService,
    private readonly auditService: AuditService,
    private readonly stageService: LoadStageService,
    // LS_N_0017 — refuses a vehicle or driver with an expired document at Load Assignment.
    private readonly assignmentComplianceService: AssignmentComplianceService,
    // Driver card + push when the loading point or its contact changes — same as "New load
    // assigned" (DriverPushNotifier.notifyLoadUpdate).
    private readonly driverNotifier: DriverTripNotifier,
    /** Every upload goes through the documents register (documents/), with the load's columns. */
    private readonly documents: LoadDocumentService,
    // LS_N_0054 — optional; only queues a notification after the existing logic and never throws
    // (see notifications/breakdown-alerts.ts).
    private readonly onIssueReported?: IssueReportedNotifier,
    // Stage handoffs, e-way bill expiry, E-POD uploaded, advance due, truck assigned / blocked —
    // optional; only queues a notification and never throws (see notifications/load-alerts.ts).
    private readonly onLoadEvent?: LoadEventNotifier,
  ) {}

  /** For the driver app's E-POD reminder cards (DriverPortalService.getMyNotifications). */
  findPodCardLoads(refs: PodCardLoadRef[]): Promise<PodCardLoad[]> {
    return this.repository.findPodCardLoads(refs);
  }

  /** For the driver app's load cards (DriverPortalService.getMyNotifications). */
  findTripCardLoads(refs: TripCardRef[]): Promise<TripCardLoad[]> {
    return this.repository.findTripCardLoads(refs);
  }

  /** The stages the load has been through, with time in each (load_stage_history). */
  stageHistory(tenantId: string, loadId: string) {
    return this.stageService.historyFor(tenantId, loadId);
  }

  async assertExists(tenantId: string, id: string): Promise<LoadEntity> {
    try {
      const load = await this.repository.findById(tenantId, id);
      if (!load) throw new NotFoundError(`Load ${id} not found`);
      return load;
    } catch (error) {
      rethrow(error, 'Failed to verify load exists');
    }
  }

  /**
   * Load Assignment — the shipper awards a market load straight to one of their transporters,
   * with the truck, driver and agreed freight (Plan Dispatch v2.0 R-16). Own-fleet loads never
   * reach this: their truck is known when posted. An award keeps the load at Bids received (the
   * `transporter_awarded` trigger); the load memo, once accepted, moves it to Truck assigned.
   */
  async assign(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: AssignLoadInput,
  ): Promise<LoadEntity & { complianceWarnings: string[] }> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (load.postingType !== 'market_fleet') {
        throw new ConflictError('Only a market load is awarded through this endpoint');
      }
      if (load.status !== 'created' && load.status !== 'bids_received') {
        throw new ConflictError('Only a load that has no truck yet can be assigned');
      }

      if (!input.transporterId) throw new ValidationError('transporterId is required');
      const transporter = await this.transporterService.getTransporter(
        tenantId,
        input.transporterId,
      );
      if (!input.vehicleNumber?.trim()) throw new ValidationError('vehicleNumber is required');
      // if (!input.driverNumber?.trim()) throw new ValidationError('driverNumber is required');
      if (!input.freightType) throw new ValidationError('freightType is required');

      // C-07 — this plate can't already be on another live load, own-fleet or market. Own-fleet
      // duplicate use is caught earlier by vehicleId-based C-01/C-02 at Dispatch Planning; this
      // is the same guarantee for a market load's free-text vehicle number. No override — same
      // as C-02, a truck cannot physically be on two active trips at once.
      const vehicleNumber = input.vehicleNumber.trim().toUpperCase();
      const clash = await this.repository.findActiveByVehicleNumber(
        tenantId,
        vehicleNumber,
        loadId,
      );
      if (clash) {
        throw new ConflictError(
          `Vehicle ${vehicleNumber} is already on an active load elsewhere (load ${clash.code}, status ${humanizeStatus(clash.status)})`,
        );
      }

      // LS_N_0017 — a driver with an expired licence can't be assigned; a vehicle with an expired
      // document can, with a warning in the response. Matched to the masters by number; one that
      // isn't on file can't be checked and is let through (LS_N_0016 then says so). No override.
      const compliance = await this.assignmentComplianceService.check(tenantId, {
        vehicleNumber,
        driverPhone: input.driverNumber,
      });
      if (compliance.failure) {
        const blockedDriverName = input.driverName?.trim() || compliance.driverName;
        await this.onLoadEvent?.(
          assignmentBlockedEvent(
            tenantId,
            vehicleNumber,
            compliance,
            compliance.failure,
            { loadId, transporterName: transporter.name },
            blockedDriverName,
          ),
        );
        throw assignmentBlockedError(vehicleNumber, compliance.failure, blockedDriverName);
      }

      // The agreed rate — defaults to the target rate captured at planning if the caller doesn't
      // override it (e.g. the counter-offer negotiation landed on the original target).
      const freightValue =
        input.freightValue !== undefined ? String(input.freightValue) : load.expectedRate;

      const driverNumber = input.driverNumber?.trim() ?? null;
      const driverName = input.driverName?.trim() ?? null;
      const updated = await this.stageService.transition({
        tenantId,
        loadId,
        trigger: 'transporter_awarded',
        actorId,
        load,
        auditAction: 'LOAD_ASSIGNED',
        fields: {
          transporterId: input.transporterId,
          vehicleNumber,
          driverNumber,
          driverName,
          freightType: input.freightType,
          freightValue,
        },
        metadata: { vehicleNumber, driverNumber, driverName },
      });

      // LS_N_0016 — truck and driver assigned.
      await this.onLoadEvent?.({
        kind: 'assigned',
        tenantId,
        loadId,
        at: new Date(),
        vehicleChecked: compliance.vehicleChecked,
        driverChecked: compliance.driverChecked,
      });

      return {
        ...updated,
        complianceWarnings: compliance.warnings.map((warning) =>
          vehicleDocumentWarning(vehicleNumber, warning),
        ),
      };
    } catch (error) {
      rethrow(error, 'Failed to assign load');
    }
  }

  /** Who assigned each load plus the fleet owner behind it, for the trip rows and trip detail.
   *  Loads can span tenants (a driver linked to several fleets), so the owner is looked up once
   *  per distinct tenant. */
  private async tripAssignments(loads: LoadEntity[]): Promise<Map<string, TripAssignment>> {
    const tenantIds = [...new Set(loads.map((load) => load.tenantId))];
    const [assignedBy, owners] = await Promise.all([
      this.loadActivityService.assignedByLoad(loads),
      Promise.all(tenantIds.map((id) => this.authService.getFleetOwner(id))),
    ]);
    const ownerByTenant = new Map(tenantIds.map((id, i) => [id, owners[i]]));
    return new Map(
      loads.map((load) => [
        load.id,
        {
          assignedBy: assignedBy.get(load.id) ?? null,
          fleetOwner: ownerByTenant.get(load.tenantId) ?? null,
        },
      ]),
    );
  }

  /** Validates a document was uploaded via the storage module for the expected purpose and is
   *  confirmed, before attaching its key to the load — same pattern as
   *  driver/driver.service.ts's assertDriverDlUpload. */
  private async assertLoadDocumentUpload(
    tenantId: string,
    actorRole: string,
    key: string,
    expectedPurpose: string,
  ): Promise<void> {
    try {
      const { file } = await this.storageService.getByKey({ tenantId, role: actorRole }, key);
      if (file.purpose !== expectedPurpose) {
        throw new ValidationError(`File ${key} was not uploaded for purpose ${expectedPurpose}`);
      }
      if (file.status !== 'confirmed') {
        throw new ValidationError(`File ${key} must be confirmed before it can be attached`);
      }
    } catch (error) {
      rethrow(error, 'Failed to verify uploaded load document');
    }
  }

  /** Resolves a load's storage-key document fields into fresh, short-lived download URLs. */
  private async withDocumentDownloadUrls(
    tenantId: string,
    actorRole: string,
    load: LoadEntity,
  ): Promise<LoadEntity> {
    const resolve = async (key: string): Promise<string> =>
      (await this.resolveDownloadUrl(tenantId, actorRole, key)) ?? key;
    const resolveNullable = async (key: string | null) => (key ? resolve(key) : key);
    return {
      ...load,
      invoiceFileKey: await resolveNullable(load.invoiceFileKey),
      ewayBillFileKey: await resolveNullable(load.ewayBillFileKey),
      elrFileKey: await resolveNullable(load.elrFileKey),
      podFileKey: await resolveNullable(load.podFileKey),
      podBackFileKey: await resolveNullable(load.podBackFileKey),
      weighingSlipFileKey: await resolveNullable(load.weighingSlipFileKey),
      loadingPhotoFileKeys: load.loadingPhotoFileKeys
        ? await Promise.all(load.loadingPhotoFileKeys.map(resolve))
        : load.loadingPhotoFileKeys,
    };
  }

  /** A fresh signed download URL for a stored file key, or null when the file isn't a confirmed
   *  upload (StorageService hands back no URL for pending/failed files). */
  private async resolveDownloadUrl(
    tenantId: string,
    actorRole: string,
    key: string,
  ): Promise<string | null> {
    const { downloadUrl } = await this.storageService.getByKey({ tenantId, role: actorRole }, key);
    return downloadUrl;
  }

  /** Shared by confirmLoading and updateDocuments — verifies whichever document fields were
   *  submitted this call (previously-saved keys were already verified as confirmed uploads for
   *  the right purpose when first submitted) and returns the row fields to persist. Doesn't touch
   *  status/completeness — callers own that. */
  private async buildDocumentFields(
    tenantId: string,
    actorId: string,
    actorRole: string,
    load: LoadEntity,
    input: ConfirmLoadingInput,
  ): Promise<UpdateLoadData> {
    // C-04 — LR numbers are statutory and can never repeat, checked across every load in the
    // tenant regardless of status. Blocking, no override. Only checked when this call is
    // actually setting/changing the number — otherwise a partial-submission caller resubmitting
    // its own already-stored elrNumber would self-clash against the row it's about to update.
    const nextElrNumber = input.elrNumber?.trim();
    if (nextElrNumber && nextElrNumber !== load.elrNumber) {
      const clash = await this.repository.findByElrNumber(tenantId, nextElrNumber);
      if (clash) {
        throw new ConflictError(
          `E-LR number "${nextElrNumber}" is already used on load ${clash.code}`,
        );
      }
    }

    if (input.invoiceFileKey) {
      await this.assertLoadDocumentUpload(
        tenantId,
        actorRole,
        input.invoiceFileKey,
        'loads/invoice',
      );
    }
    if (input.ewayBillFileKey) {
      await this.assertLoadDocumentUpload(
        tenantId,
        actorRole,
        input.ewayBillFileKey,
        'loads/eway-bill',
      );
    }
    if (input.elrFileKey) {
      await this.assertLoadDocumentUpload(tenantId, actorRole, input.elrFileKey, 'trips/lr');
    }
    if (input.loadingPhotoFileKeys) {
      for (const key of input.loadingPhotoFileKeys) {
        await this.assertLoadDocumentUpload(tenantId, actorRole, key, 'loads/loading-photo');
      }
    }
    if (input.weighingSlipFileKey) {
      await this.assertLoadDocumentUpload(
        tenantId,
        actorRole,
        input.weighingSlipFileKey,
        'loads/weighing-slip',
      );
    }

    const fields: UpdateLoadData = { updatedBy: actorId };
    if (input.invoiceNumber !== undefined) fields.invoiceNumber = input.invoiceNumber.trim();
    if (input.invoiceFileKey !== undefined) fields.invoiceFileKey = input.invoiceFileKey;
    if (input.ewayBillNumber !== undefined) fields.ewayBillNumber = input.ewayBillNumber.trim();
    if (input.ewayBillFileKey !== undefined) {
      fields.ewayBillFileKey = input.ewayBillFileKey;
      // Stamped when the e-way bill is actually uploaded (this call), not whenever the last
      // document happens to land — getEwayBillExpiry's 2-hour clock runs from generation time.
      fields.ewayBillGeneratedAt = new Date();
      // The validity date printed on the bill; a new bill with none clears the old one's.
      fields.ewayBillExpiresAt = input.ewayBillExpiresAt ?? null;
    }
    if (input.elrNumber !== undefined) fields.elrNumber = nextElrNumber ?? null;
    if (input.elrFileKey !== undefined) fields.elrFileKey = input.elrFileKey;
    // Non-mandatory — whole-array replace, not accumulated, same as every field above.
    if (input.loadingPhotoFileKeys !== undefined) {
      fields.loadingPhotoFileKeys = input.loadingPhotoFileKeys;
    }
    if (input.weighingSlipFileKey !== undefined) {
      fields.weighingSlipFileKey = input.weighingSlipFileKey;
    }
    return fields;
  }

  private async recordDocumentUpload(
    tenantId: string,
    loadId: string,
    actorId: string,
    input: ConfirmLoadingInput,
  ): Promise<void> {
    const uploadedMetadata: Record<string, unknown> = {};
    if (input.invoiceNumber !== undefined) uploadedMetadata.invoiceNumber = input.invoiceNumber;
    if (input.ewayBillNumber !== undefined) uploadedMetadata.ewayBillNumber = input.ewayBillNumber;
    if (input.elrFileKey !== undefined) uploadedMetadata.elrNumber = input.elrNumber ?? null;
    // Which documents this call carried — the timeline names them (all three papers → generic).
    const documents: string[] = [];
    if (input.invoiceFileKey !== undefined) documents.push('invoice');
    if (input.ewayBillFileKey !== undefined) documents.push('ewayBill');
    if (input.elrFileKey !== undefined) documents.push('elr');
    if (input.loadingPhotoFileKeys !== undefined) documents.push('loadingPhotos');
    if (input.weighingSlipFileKey !== undefined) documents.push('weighingSlip');
    if (documents.length > 0) uploadedMetadata.documents = documents;
    await this.loadActivityService.record(
      tenantId,
      loadId,
      actorId,
      'DOCUMENT_UPLOADED',
      null,
      null,
      uploadedMetadata,
    );
  }

  /**
   * Attach/replace load documents (invoice/e-way bill/E-LR/loading photos/weighing slip) at any
   * point in the load's lifecycle except once closed (terminal). Useful for correcting or adding
   * a document after the fact (e.g. a wrong invoice number). Like confirmLoading, a load at the
   * loading point moves to Loaded as soon as the three loading papers are all on it — "3 papers
   * move it to Loaded" holds whichever endpoint delivered the last one.
   *
   * `driverOwnerId` is set only by driver-portal's self-service call — same ownership-check-as-
   * 404 convention as confirmLoading/uploadPod below.
   */
  async updateDocuments(
    tenantId: string,
    actorId: string,
    actorRole: string,
    loadId: string,
    input: ConfirmLoadingInput,
    driverOwnerId?: string,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (driverOwnerId && load.driverId !== driverOwnerId) {
        throw new NotFoundError(`Load ${loadId} not found`);
      }
      if (load.status === 'closed') {
        throw new ConflictError('Documents cannot be changed once a load is closed');
      }

      const fields = await this.buildDocumentFields(tenantId, actorId, actorRole, load, input);
      const updated = await this.documents.save(
        tenantId,
        load,
        fields,
        documentActor(actorId, driverOwnerId),
      );

      await this.recordDocumentUpload(tenantId, loadId, actorId, input);
      await this.notifyEwayBillGenerated(tenantId, loadId, fields, updated);

      return await this.advanceIfPapersComplete(tenantId, actorId, updated, driverOwnerId);
    } catch (error) {
      rethrow(error, 'Failed to update load documents');
    }
  }

  /** Ops or the assigned driver attaches invoice/e-way bill/signed LR (mandatory — but only
   *  whichever aren't already on the load) plus optional loading photos/weighing slip at the
   *  loading point. Documents may be submitted one at a time or all together; the load moves to
   *  Loaded once all three papers end up on the row, whether accumulated across calls or already
   *  present from an earlier caller (advanceIfPapersComplete).
   *
   *  `driverOwnerId` is set only by driver-portal's self-service call — same ownership-check-as-
   *  404 convention as uploadPod/reportIssue. */
  async confirmLoading(
    tenantId: string,
    actorId: string,
    actorRole: string,
    loadId: string,
    input: ConfirmLoadingInput,
    driverOwnerId?: string,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (driverOwnerId && load.driverId !== driverOwnerId) {
        throw new NotFoundError(`Load ${loadId} not found`);
      }
      if (load.status !== 'reached_loading') {
        throw new ConflictError('Loading papers can only be confirmed at the loading point');
      }

      const fields = await this.buildDocumentFields(tenantId, actorId, actorRole, load, input);

      // Persist whatever arrived this call, then decide completeness from the fresh, post-write
      // row rather than an in-memory merge of the pre-write read: that's what lets two concurrent
      // calls, each landing one of the last two missing papers, both see the full set.
      const updated = await this.documents.save(
        tenantId,
        load,
        fields,
        documentActor(actorId, driverOwnerId),
      );

      await this.recordDocumentUpload(tenantId, loadId, actorId, input);
      await this.notifyEwayBillGenerated(tenantId, loadId, fields, updated);

      return await this.advanceIfPapersComplete(tenantId, actorId, updated, driverOwnerId);
    } catch (error) {
      rethrow(error, 'Failed to confirm loading');
    }
  }

  /** Loadsmart's Tracking team attaches the loading papers it holds (invoice, e-way bill, signed
   *  LR) from the ops console. Same checks and writes as the shipper's upload, recorded with the
   *  `console` source; the caller (LsSettlementService.uploadPapers) has already adopted the files
   *  into the shipper's tenant and decided they may be attached. */
  async saveConsoleDocuments(
    tenantId: string,
    actorId: string,
    actorRole: string,
    loadId: string,
    input: ConfirmLoadingInput,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (load.status === 'closed') {
        throw new ConflictError('Documents cannot be changed once a load is closed');
      }
      const fields = await this.buildDocumentFields(tenantId, actorId, actorRole, load, input);
      const updated = await this.documents.save(
        tenantId,
        load,
        fields,
        documentActor(actorId, undefined, true),
      );
      await this.recordDocumentUpload(tenantId, loadId, actorId, input);
      await this.notifyEwayBillGenerated(tenantId, loadId, fields, updated);
      return updated;
    } catch (error) {
      rethrow(error, 'Failed to save the load documents');
    }
  }

  /** A (re)generated e-way bill gets its own expiry alert; an older bill's alert drops itself. */
  private async notifyEwayBillGenerated(
    tenantId: string,
    loadId: string,
    fields: UpdateLoadData,
    updated: LoadEntity,
  ): Promise<void> {
    if (!fields.ewayBillGeneratedAt || !updated.ewayBillGeneratedAt) return;
    const { expiresAt } = this.getEwayBillExpiry(updated);
    if (!expiresAt) return;
    await this.onLoadEvent?.({
      kind: 'eway_bill_generated',
      tenantId,
      loadId,
      generatedAt: updated.ewayBillGeneratedAt,
      expiresAt: new Date(expiresAt),
    });
  }

  /** "3 papers move it to Loaded": a load at the loading point moves to Loaded once invoice,
   *  e-way bill and signed LR are all on it. The stage service's conditional update is the race
   *  guard — if a concurrent call already moved it, this one just returns the current row. */
  private async advanceIfPapersComplete(
    tenantId: string,
    actorId: string,
    load: LoadEntity,
    driverOwnerId?: string,
  ): Promise<LoadEntity> {
    if (load.status !== 'reached_loading' || !hasLoadingPapers(load)) return load;
    // On a Loadsmart load the truck waits for the papers to be approved
    // by Loadsmart's Tracking team in the documents register — complete papers alone don't move it.
    if (load.route === 'loadsmart') return load;
    try {
      const loaded = await this.stageService.transition({
        tenantId,
        loadId: load.id,
        trigger: 'papers_complete',
        actorId,
        driverOwnerId,
        load,
        auditAction: 'LOAD_LOADING_CONFIRMED',
        fields: { loadingConfirmedBy: actorId },
      });
      // LS_N_0024 — vehicle loaded (documents and e-way bill folded into one card).
      const { expiresAt: ewayBillExpiresAt } = this.getEwayBillExpiry(loaded);
      await this.onLoadEvent?.({
        kind: 'loading_confirmed',
        tenantId,
        loadId: load.id,
        at: loaded.loadingConfirmedAt ?? new Date(),
        confirmedBy: driverOwnerId ? { driverId: actorId } : { userId: actorId },
        ewayBillExpiresAt: ewayBillExpiresAt ? new Date(ewayBillExpiresAt) : null,
      });
      return loaded;
    } catch (error) {
      if (error instanceof ConflictError) return this.assertExists(tenantId, load.id);
      throw error;
    }
  }

  /** Computed on read — no scheduler/queue infra exists in this repo yet (src/jobs/queue-registry.ts
   *  is a no-op placeholder), so the 2-hour e-way-bill expiry is a derived flag, not a
   *  pushed notification. // TODO: wire a real alert once queue infra exists. */
  getEwayBillExpiry(load: LoadEntity): EwayBillExpiry {
    if (!load.ewayBillGeneratedAt) return { expiresAt: null, expired: false };
    // The validity date typed with the upload; the 2-hour placeholder only when none was given.
    const expiresAt =
      load.ewayBillExpiresAt ??
      new Date(load.ewayBillGeneratedAt.getTime() + EWAY_BILL_VALIDITY_MS);
    const stillMoving =
      !UNLOADED_LOAD_STATUSES.includes(load.status) &&
      load.status !== 'closed' &&
      load.status !== 'cancelled';
    return { expiresAt: expiresAt.toISOString(), expired: stillMoving && new Date() > expiresAt };
  }

  /** Manual stage mark — Start trip, Reached loading point, left for the drop, Reached unloading
   *  point. There is no live tracking yet, so these move the load through Execution; the stage
   *  service rejects skipping ahead or moving backward.
   *
   *  `driverOwnerId` is set only by driver-portal's self-service call — when present, the caller
   *  must be this load's own assigned driver (masked as not-found otherwise, same "no IDOR
   *  surface" convention driver-portal's getMyLoads already follows). */
  async updateStatus(
    tenantId: string,
    actorId: string,
    loadId: string,
    toStatus: ManualTrackingStatus,
    driverOwnerId?: string,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (driverOwnerId && load.driverId !== driverOwnerId) {
        throw new NotFoundError(`Load ${loadId} not found`);
      }
      // For now the shipper may mark every stage by hand, tracked load or not (e.g. a SIM load
      // waiting on the driver's consent). Tracking events still move the load too.
      await this.assertNotHalted(tenantId, loadId);
      const moved = await this.stageService.transition({
        tenantId,
        loadId,
        trigger: MANUAL_MARK_TRIGGERS[toStatus],
        actorId,
        driverOwnerId,
        load,
      });
      // Papers attached on the way in move the load to Loaded as soon as it reaches the gate.
      return await this.advanceIfPapersComplete(tenantId, actorId, moved, driverOwnerId);
    } catch (error) {
      rethrow(error, 'Failed to update load status');
    }
  }

  /** Tracking's `trip.started` (the truck moved the trip-start distance from where it was
   *  assigned) moves a "Truck assigned" load to "In transit to loading" at the time of that
   *  movement — stage 4, the step the driver or staff would otherwise tap by hand. A load already
   *  past it, one whose trip can't start yet (memo not accepted), or one on hold after an
   *  incident is left alone. Returns whether it moved. */
  async markTripStarted(tenantId: string, loadId: string, at: Date): Promise<boolean> {
    try {
      const load = await this.repository.findById(tenantId, loadId);
      if (load?.status !== 'truck_assigned') return false;
      return Boolean(
        await this.advanceFromTracking(
          tenantId,
          load,
          'in_transit_loading',
          'inTransitLoadingAt',
          at,
        ),
      );
    } catch (error) {
      rethrow(error, 'Failed to start the trip from tracking');
    }
  }

  /** Tracking's `trip.arrived_at_pickup` (the vehicle entered the loading point's geofence) moves
   *  a load still on its way to the loading point to "Reached loading point" at the arrival time —
   *  the same step the driver or staff can take by hand (updateStatus), whichever comes first. A
   *  load still at "Truck assigned" is started first (In transit to loading). A load already
   *  past it, one whose trip can't start yet (memo not accepted), or one on hold after an
   *  incident is left alone. Returns whether it moved. */
  async markArrivedAtPickup(tenantId: string, loadId: string, at: Date): Promise<boolean> {
    try {
      const load = await this.repository.findById(tenantId, loadId);
      if (!load) return false;
      if (load.status === 'truck_assigned') {
        const started = await this.advanceFromTracking(
          tenantId,
          load,
          'in_transit_loading',
          'inTransitLoadingAt',
          at,
        );
        if (!started) return false;
        return Boolean(
          await this.advanceFromTracking(tenantId, started, 'reached_loading', 'atPlantAt', at),
        );
      }
      if (load.status !== 'in_transit_loading') return false;
      return Boolean(
        await this.advanceFromTracking(tenantId, load, 'reached_loading', 'atPlantAt', at),
      );
    } catch (error) {
      rethrow(error, 'Failed to mark the load at the loading point from tracking');
    }
  }

  /** Tracking's `trip.arrived_at_drop` (the vehicle entered the delivery point's geofence) moves an
   *  "In transit to unloading" load to "Reached unloading point" at the arrival time. Same rules
   *  as markArrivedAtPickup. Returns whether it moved. */
  async markReachedDeliveryPoint(tenantId: string, loadId: string, at: Date): Promise<boolean> {
    try {
      const load = await this.repository.findById(tenantId, loadId);
      if (load?.status !== 'in_transit_unloading') return false;
      return Boolean(
        await this.advanceFromTracking(
          tenantId,
          load,
          'reached_unloading',
          'reachedDeliveryPointAt',
          at,
        ),
      );
    } catch (error) {
      rethrow(error, 'Failed to mark the load at the delivery point from tracking');
    }
  }

  /** Tracking's `trip.departed_pickup` (the loaded vehicle left the loading point's geofence) moves
   *  a "Loaded" load to "In transit to unloading" at the departure time — the step the driver or
   *  staff would otherwise tap by hand. Same rules as markArrivedAtPickup; a load already marked
   *  in transit is left alone. Returns whether it moved. */
  async markDepartedPickup(tenantId: string, loadId: string, at: Date): Promise<boolean> {
    try {
      const load = await this.repository.findById(tenantId, loadId);
      if (load?.status !== 'loaded') return false;
      return Boolean(
        await this.advanceFromTracking(tenantId, load, 'in_transit_unloading', 'inTransitAt', at),
      );
    } catch (error) {
      rethrow(error, 'Failed to mark the load in transit from tracking');
    }
  }

  /** Tracking's `trip.departed_drop` (the vehicle left the delivery point's geofence) records when
   *  it left — before or after the E-POD. It doesn't change the status (unloading is confirmed by
   *  the E-POD), but ends unloading detention (LS_N_0032) and completes the trip (LS_N_0033).
   *  Recorded once; returns whether it was. */
  async markDepartedDrop(tenantId: string, loadId: string, at: Date): Promise<boolean> {
    try {
      const updated = await this.repository.markDepartedDrop(tenantId, loadId, at);
      if (!updated) return false;
      await this.auditService.log({
        tenantId,
        userId: null,
        action: 'LOAD_DEPARTED_DROP_BY_TRACKING',
        resourceType: 'load',
        oldData: { id: loadId, departedDropAt: null },
        newData: { id: loadId, status: updated.status, departedDropAt: at.toISOString() },
      });
      return true;
    } catch (error) {
      rethrow(error, 'Failed to record the departure from the delivery point');
    }
  }

  /** Tracking's `trip.detention_detected` (the truck has been inside the loading or unloading
   *  geofence for more than the detention time) flags the load "Detention detected" — once; a
   *  replayed or later event changes nothing. The billable detention (LS_N_0023 / LS_N_0032)
   *  keeps running on its own free-hours clock. Returns whether the load was flagged. */
  async markDetentionDetected(
    tenantId: string,
    loadId: string,
    point: 'loading' | 'unloading',
    at: Date,
  ): Promise<boolean> {
    try {
      const updated = await this.repository.markDetentionDetected(tenantId, loadId, point, at);
      if (!updated) return false;
      await this.auditService.log({
        tenantId,
        userId: null,
        action: 'LOAD_DETENTION_DETECTED_BY_TRACKING',
        resourceType: 'load',
        oldData: { id: loadId, detentionDetectedAt: null },
        newData: {
          id: loadId,
          status: updated.status,
          detentionPoint: point,
          detentionDetectedAt: at.toISOString(),
        },
      });
      return true;
    } catch (error) {
      rethrow(error, 'Failed to flag the load as detention detected');
    }
  }

  /** One tracking-driven step (no acting user) through the stage service, stamped at tracking's
   *  time: never while the trip is on hold, and a move the stage rules refuse (or a concurrent
   *  move that got there first) is skipped, not an error. The activity row carries
   *  `source: 'tracking'` — detention (LS_N_0023/0032) reads it — and the stage's notification
   *  follows from the stage service. Returns the moved load, or null. */
  private async advanceFromTracking(
    tenantId: string,
    load: LoadEntity,
    to: 'in_transit_loading' | 'reached_loading' | 'in_transit_unloading' | 'reached_unloading',
    timestampField: 'inTransitLoadingAt' | 'atPlantAt' | 'inTransitAt' | 'reachedDeliveryPointAt',
    at: Date,
  ): Promise<LoadEntity | null> {
    try {
      await this.assertNotHalted(tenantId, load.id);
      return await this.stageService.transition({
        tenantId,
        loadId: load.id,
        trigger: MANUAL_MARK_TRIGGERS[to],
        actorId: null,
        load,
        auditAction: 'LOAD_STATUS_UPDATED_BY_TRACKING',
        fields: { [timestampField]: at },
        metadata: { source: 'tracking' },
      });
    } catch (error) {
      if (error instanceof ConflictError) return null;
      throw error;
    }
  }

  /** Step 1 of the driver-app delivery flow: sends a 4-digit code to the receiver's phone.
   *  Ownership-checked like uploadPod; the code is verified there, at final submission. */
  async sendPodReceiverCode(
    tenantId: string,
    loadId: string,
    mobile: string,
    driverOwnerId: string,
  ): Promise<void> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (load.driverId !== driverOwnerId) {
        throw new NotFoundError(`Load ${loadId} not found`);
      }
      if (!this.canRecordPod(load)) {
        throw new ConflictError(
          'E-POD can only be recorded once the truck has left for the unloading point',
        );
      }
      // Static code for now — nothing to send; see POD_RECEIVER_STATIC_OTP. A fresh send always
      // gets a fresh guess budget and invalidates any earlier verification of this number.
      await redisManager.delete(podReceiverAttemptsKey(loadId, mobile));
      await redisManager.delete(podReceiverVerifiedKey(loadId, mobile));
    } catch (error) {
      rethrow(error, 'Failed to send receiver code');
    }
  }

  /** Step 1b of the driver-app delivery flow: checks the code the receiver read out. On success
   *  the number is marked verified (Redis, short TTL) for this load, and uploadPod then requires
   *  that mark whenever a receiver mobile is submitted. */
  async verifyPodReceiverCode(
    tenantId: string,
    loadId: string,
    mobile: string,
    code: string,
    driverOwnerId: string,
  ): Promise<void> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (load.driverId !== driverOwnerId) {
        throw new NotFoundError(`Load ${loadId} not found`);
      }
      if (!this.canRecordPod(load)) {
        throw new ConflictError(
          'E-POD can only be recorded once the truck has left for the unloading point',
        );
      }
      const attempts = await redisManager.incr(
        podReceiverAttemptsKey(loadId, mobile),
        POD_RECEIVER_VERIFIED_TTL_SECONDS,
      );
      if (attempts > MAX_OTP_ATTEMPTS) {
        throw new AuthenticationError(msg('errors.otp.tooManyAttempts'));
      }
      if (code !== POD_RECEIVER_STATIC_OTP) {
        throw new AuthenticationError(msg('errors.otp.invalid'));
      }
      await redisManager.delete(podReceiverAttemptsKey(loadId, mobile));
      await redisManager.set(
        podReceiverVerifiedKey(loadId, mobile),
        '1',
        POD_RECEIVER_VERIFIED_TTL_SECONDS,
      );
    } catch (error) {
      rethrow(error, 'Failed to verify receiver code');
    }
  }

  /** The E-POD is taken at the drop. A load still marked on its way to the drop is accepted too
   *  — with no live tracking the driver may not have marked the arrival — and uploadPod marks it
   *  reached first. Until the POD is decided (reviewPod) it can be replaced; a rejected one is
   *  resubmitted the same way. */
  private canRecordPod(load: LoadEntity): boolean {
    return (
      (load.status === 'in_transit_unloading' || load.status === 'reached_unloading') &&
      load.podStatus !== 'accepted'
    );
  }

  /** The delivery receipt — POD front and back, receiver name/mobile, and quantity received are
   *  required; receiver designation and sealStatus are optional. Recording it doesn't decide the
   *  delivery: the load stays at Reached unloading until the shipper (or, on a Loadsmart load,
   *  Loadsmart's Tracking team) decides the POD in reviewPod — clean, or with an issue. What the
   *  driver noted is kept as the suggested answer.
   *
   *  shortageOrDamage is the driver-app screen's cargo-condition-on-arrival field — like
   *  sealStatus, never a hard block (no exceptions/escalations module exists yet to route it to);
   *  just recorded on the load's activity/audit trail. damagePhotoKey is required (validated
   *  above, and enforced server-side in load.validators.ts) whenever shortageOrDamage is
   *  'damage'/'both'; numberOfTonnesShort is accepted unconditionally regardless of
   *  shortageOrDamage's value.
   *
   *  `driverOwnerId` is set only by driver-portal's self-service call — see updateStatus's doc
   *  comment above for the ownership-check/audit-FK reasoning; identical here. */
  async uploadPod(
    tenantId: string,
    actorId: string,
    actorRole: string,
    loadId: string,
    input: UploadPodInput,
    driverOwnerId?: string,
    /** Recorded by Loadsmart's own team from the ops console (the register's source). */
    fromConsole = false,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (driverOwnerId && load.driverId !== driverOwnerId) {
        throw new NotFoundError(`Load ${loadId} not found`);
      }
      const isResubmission = load.podStatus === 'rejected' || load.podStatus === 'pending';
      if (!this.canRecordPod(load)) {
        throw new ConflictError(
          'E-POD can only be recorded once the truck has left for the unloading point',
        );
      }

      // Driver-only receiver verification: a receiver mobile must have been verified via verifyPodReceiverCode;
      // no mobile means the receiver has no phone and the POD photo alone is the proof. A
      // resubmission with the same, already-verified mobile doesn't need a fresh code.
      let podReceiverVerifiedAt: Date | null = null;
      if (driverOwnerId && input.podReceiverMobile) {
        const alreadyVerified =
          isResubmission &&
          load.podReceiverVerifiedAt &&
          load.podReceiverMobile === input.podReceiverMobile;
        if (alreadyVerified) {
          podReceiverVerifiedAt = load.podReceiverVerifiedAt;
        } else {
          const verifiedKey = podReceiverVerifiedKey(loadId, input.podReceiverMobile);
          if (!(await redisManager.get(verifiedKey))) {
            throw new ValidationError(
              'Receiver mobile must be verified (receiver-code/verify) before submitting E-POD',
            );
          }
          await redisManager.delete(verifiedKey);
          podReceiverVerifiedAt = new Date();
        }
      }

      // Driver-submitted shortage is worked out here, not trusted from the client: planned minus
      // unloaded, never negative.
      let numberOfTonnesShort = input.numberOfTonnesShort;
      let shortageOrDamage = input.shortageOrDamage;
      if (driverOwnerId) {
        const short = Math.max(
          0,
          Math.round((Number(load.plannedCapacityTonnes) - input.podQuantityReceived) * 100) / 100,
        );
        numberOfTonnesShort = short;
        if (short > 0) {
          if (!shortageOrDamage || shortageOrDamage === 'none') shortageOrDamage = 'shortage';
          else if (shortageOrDamage === 'damage') shortageOrDamage = 'both';
        }
      }

      await this.assertLoadDocumentUpload(tenantId, actorRole, input.podFileKey, 'trips/pod');
      if (input.podBackFileKey) {
        await this.assertLoadDocumentUpload(tenantId, actorRole, input.podBackFileKey, 'trips/pod');
      }
      if (input.damagePhotoKey) {
        await this.assertLoadDocumentUpload(tenantId, actorRole, input.damagePhotoKey, 'trips/pod');
      }
      if (input.stampedInvoiceFileKey) {
        await this.assertLoadDocumentUpload(
          tenantId,
          actorRole,
          input.stampedInvoiceFileKey,
          'trips/pod',
        );
      }

      const podFields: UpdateLoadData = {
        // Only stamp deliveredAt on the first upload — a resubmission after rejection doesn't
        // change when the truck physically arrived.
        ...(isResubmission ? {} : { deliveredAt: new Date() }),
        podFileKey: input.podFileKey,
        podBackFileKey: input.podBackFileKey ?? null,
        podReceiverName: input.podReceiverName,
        podReceiverMobile: input.podReceiverMobile ?? null,
        podReceiverVerifiedAt,
        podReceiverDesignation: input.podReceiverDesignation ?? null,
        podQuantityReceived: String(input.podQuantityReceived),
        sealStatus: input.sealStatus ?? null,
        shortageOrDamage: shortageOrDamage ?? null,
        numberOfTonnesShort: numberOfTonnesShort === undefined ? null : String(numberOfTonnesShort),
        damagePhotoKey: input.damagePhotoKey ?? null,
        podRemarks: input.podRemarks ?? null,
        // Every upload (first or resubmission) waits for a fresh decision.
        podStatus: 'pending',
        podRejectionReason: null,
      };

      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'DOCUMENT_UPLOADED',
        null,
        null,
        {
          pod: true,
          sealStatus: input.sealStatus,
          shortageOrDamage,
          receiverVerified: Boolean(podReceiverVerifiedAt),
        },
      );

      let current = load;
      if (current.status === 'in_transit_unloading') {
        current = await this.stageService.transition({
          tenantId,
          loadId,
          trigger: 'reached_unloading',
          actorId,
          driverOwnerId,
          load: current,
        });
      }
      const updated = await this.documents.save(
        tenantId,
        current,
        { ...podFields, updatedBy: actorId },
        documentActor(actorId, driverOwnerId, fromConsole),
        input.stampedInvoiceFileKey
          ? [{ docType: 'stamped_invoice', fileKey: input.stampedInvoiceFileKey }]
          : [],
      );
      await this.auditService.log({
        tenantId,
        userId: driverOwnerId ? null : actorId,
        action: driverOwnerId ? 'LOAD_POD_RECORDED_BY_DRIVER' : 'LOAD_POD_RECORDED',
        resourceType: 'load',
        oldData: { id: loadId, podStatus: load.podStatus },
        newData: {
          id: loadId,
          podStatus: 'pending',
          sealStatus: input.sealStatus,
          shortageOrDamage,
          ...(driverOwnerId ? { driverId: actorId } : {}),
        },
      });

      await this.onLoadEvent?.({ kind: 'pod_uploaded', tenantId, loadId, at: new Date() });

      // The stage moves only when the POD is decided (reviewPod).
      return updated;
    } catch (error) {
      rethrow(error, 'Failed to upload E-POD');
    }
  }

  /** "Change contact" on the load page — who meets the truck at the loading point, this load only.
   *  Shared with the driver and used by the next load memo. */
  async setLoadingContact(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: SetLoadingContactInput,
    actor?: PermissionHolder,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      LoadService.assertBeforeLoadingPoint(load);
      // "Use for every load from this point" changes the master — a masters editor's call.
      let pointId: string | null = null;
      if (input.applyToPoint) {
        if (!actor || !hasPermission(actor, MASTERS_WRITE)) {
          throw new AuthorizationError(
            'Saving the contact to the loading point needs masters.write',
          );
        }
        pointId = await this.repository.loadingPointIdOf(load);
        if (!pointId) {
          throw new ConflictError('This load loads at a typed address, not a saved loading point');
        }
      }
      const updated = await this.repository.update(tenantId, loadId, {
        loadingContactName: input.name,
        loadingContactPhone: input.phone,
        updatedBy: actorId,
      });
      if (!updated) throw new ConflictError('Changing the loading contact failed');

      const before = load.loadingContactName ?? load.loadingPoint?.contactPersonName ?? null;
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'LOADING_CONTACT_CHANGED',
        before?.slice(0, 100) ?? null,
        input.name.slice(0, 100),
        { name: input.name, phone: input.phone },
      );
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOAD_LOADING_CONTACT_CHANGED',
        resourceType: 'load',
        oldData: {
          id: loadId,
          loadingContactName: load.loadingContactName,
          loadingContactPhone: load.loadingContactPhone,
        },
        newData: {
          id: loadId,
          loadingContactName: input.name,
          loadingContactPhone: input.phone,
          appliedToLoadingPointId: pointId,
        },
      });
      if (pointId) {
        await this.repository.setLoadingPointContact(tenantId, pointId, input, actorId);
      }
      await this.notifyDriver(tenantId, load, {
        type: DRIVER_LOADING_CONTACT_CHANGED_NOTIFICATION_TYPE,
        params: { loadCode: load.code, name: input.name, phoneNumber: input.phone },
      });
      return updated;
    } catch (error) {
      rethrow(error, 'Failed to change the loading contact');
    }
  }

  /** Unloading details — "M before arrival": the receiver (name and mobile) or the warehouse
   *  appointment (ID, date and slot). The shipper adds them; on a Loadsmart load Loadsmart's
   *  Tracking team can too (`actorType` 'ls_team'). */
  async setUnloadingDetails(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: UnloadingDetailsInput,
    actorType: 'shipper' | 'ls_team' = 'shipper',
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (actorType === 'ls_team' && load.route !== 'loadsmart') {
        throw new ConflictError('Loadsmart adds unloading details only on Loadsmart loads');
      }
      const arrived: readonly LoadStatus[] = [
        'reached_unloading',
        ...UNLOADED_LOAD_STATUSES,
        'closed',
      ];
      if (arrived.includes(load.status)) {
        throw new ConflictError('Unloading details are added before the truck reaches the drop');
      }
      const hasReceiver = Boolean(input.receiverName && input.receiverPhone);
      const hasAppointment = Boolean(
        input.appointmentId && input.appointmentDate && input.appointmentSlot,
      );
      if (!hasReceiver && !hasAppointment) {
        throw new ValidationError(
          'Add the receiver (name and mobile) or the appointment (ID, date and slot)',
        );
      }

      const fields: UpdateLoadData = {
        unloadingContactName: hasReceiver ? input.receiverName! : null,
        unloadingContactPhone: hasReceiver ? input.receiverPhone! : null,
        unloadingAppointmentId: hasAppointment ? input.appointmentId! : null,
        unloadingAppointmentDate: hasAppointment ? input.appointmentDate! : null,
        unloadingAppointmentSlot: hasAppointment ? input.appointmentSlot! : null,
        unloadingDetailsAddedBy: actorId,
        unloadingDetailsAddedAt: new Date(),
        updatedBy: actorId,
      };
      const updated = await this.repository.update(tenantId, loadId, fields);
      if (!updated) throw new ConflictError('Saving the unloading details failed');

      const details = {
        receiverName: fields.unloadingContactName,
        receiverPhone: fields.unloadingContactPhone,
        appointmentId: fields.unloadingAppointmentId,
        appointmentDate: fields.unloadingAppointmentDate,
        appointmentSlot: fields.unloadingAppointmentSlot,
      };
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'UNLOADING_DETAILS_SAVED',
        null,
        null,
        { ...details, by: actorType },
      );
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOAD_UNLOADING_DETAILS_SAVED',
        resourceType: 'load',
        oldData: {
          id: loadId,
          receiverName: load.unloadingContactName,
          receiverPhone: load.unloadingContactPhone,
          appointmentId: load.unloadingAppointmentId,
        },
        newData: { id: loadId, ...details },
      });
      return updated;
    } catch (error) {
      rethrow(error, 'Failed to save the unloading details');
    }
  }

  /** "Change loading point" on the load page — another saved, active loading point, this load
   *  only (the requisition/posting keep theirs). Clears a changed contact so the new point's own
   *  contact person applies. */
  async setLoadingPoint(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: SetLoadingPointInput,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      LoadService.assertBeforeLoadingPoint(load);
      const point = await this.repository.findLoadingPoint(tenantId, input.loadingPointId);
      if (!point) throw new NotFoundError('Loading point not found');
      if (point.status !== 'active') {
        throw new ConflictError('Only an active loading point can be used');
      }
      const updated = await this.repository.update(tenantId, loadId, {
        loadingPointId: point.id,
        loadingContactName: null,
        loadingContactPhone: null,
        updatedBy: actorId,
      });
      if (!updated) throw new ConflictError('Changing the loading point failed');

      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'LOADING_POINT_CHANGED',
        load.loadingPoint?.title.slice(0, 100) ?? null,
        point.title.slice(0, 100),
        { loadingPointId: point.id, title: point.title, city: point.city },
      );
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOAD_LOADING_POINT_CHANGED',
        resourceType: 'load',
        oldData: { id: loadId, loadingPointId: load.loadingPointId },
        newData: { id: loadId, loadingPointId: point.id },
      });
      await this.notifyDriver(
        tenantId,
        load,
        {
          type: DRIVER_LOADING_POINT_CHANGED_NOTIFICATION_TYPE,
          params: { loadCode: load.code, pointTitle: point.title, city: point.city },
        },
        // The card's `trip` flag tells a later change apart by the point's id.
        { loadingPointId: point.id },
      );
      return (await this.repository.findById(tenantId, loadId)) ?? updated;
    } catch (error) {
      rethrow(error, 'Failed to change the loading point');
    }
  }

  /** Loading point or contact changed — to the load's driver, same as "New load assigned": one
   *  in-app card always (signed in or not), plus a push to each signed-in device. Never throws:
   *  the change itself is already saved. */
  private async notifyDriver(
    tenantId: string,
    load: LoadEntity,
    message: DriverMessage,
    extraMetadata: Record<string, unknown> = {},
  ): Promise<void> {
    if (!load.driverId) return;
    await this.driverNotifier.notifyLoadUpdate(tenantId, load.driverId, message, {
      ...extraMetadata,
      loadIds: [load.id],
    });
  }

  /** The loading point and its contact can change only until the truck gets there. */
  private static assertBeforeLoadingPoint(load: LoadEntity): void {
    const open: readonly LoadStatus[] = [
      'created',
      'bids_received',
      'truck_assigned',
      'in_transit_loading',
    ];
    if (!open.includes(load.status)) {
      throw new ConflictError('The truck is already at the loading point');
    }
  }

  /** The POD decision (PATCH /loads/:loadId/pod/review). "Was there any issue?" — the shipper
   *  answers on own fleet, own transporter and indent; on a Loadsmart load Loadsmart's Tracking
   *  team does (`actorType` 'ls_team', from the ops console).
   *  - Accepted, no issue → Delivered (`pod_clean`); own fleet then closes at once.
   *  - Accepted with an issue (shortage, damage, pilferage…) → Delivered with issues
   *    (`pod_issue`) until settleDeliveryIssue. `shortageOrDamage` defaults to what the driver
   *    noted.
   *  - Rejected → stays at Reached unloading; the driver resubmits through uploadPod. */
  async reviewPod(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: ReviewPodInput,
    actorType: 'shipper' | 'ls_team' = 'shipper',
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (load.podStatus !== 'pending') {
        throw new ConflictError('This load has no E-POD waiting for a decision');
      }
      if ((load.route === 'loadsmart') !== (actorType === 'ls_team')) {
        throw new ConflictError(
          load.route === 'loadsmart'
            ? "On a Loadsmart load, Loadsmart's Tracking team decides the POD"
            : 'The shipper decides the POD on this load',
        );
      }
      const { decision, reason } = input;
      if (decision === 'rejected' && !reason) {
        throw new ValidationError('reason is required when rejecting an E-POD');
      }

      const reviewedAt = new Date();
      const reviewFields: UpdateLoadData = {
        podStatus: decision,
        podRejectionReason: decision === 'rejected' ? reason! : null,
        podReviewedAt: reviewedAt,
        podReviewedBy: actorId,
        updatedBy: actorId,
      };

      let updated: LoadEntity;
      let issue: ShortageOrDamageStatus | null = null;
      if (decision === 'rejected') {
        const saved = await this.repository.update(tenantId, loadId, reviewFields);
        if (!saved) throw new ConflictError('Reviewing E-POD failed');
        updated = saved;
      } else {
        issue = input.shortageOrDamage ?? load.shortageOrDamage ?? 'none';
        const trigger = podDecisionTrigger(issue);
        updated = await this.stageService.transition({
          tenantId,
          loadId,
          trigger,
          actorType,
          actorId,
          load,
          auditAction:
            trigger === 'pod_issue' ? 'LOAD_POD_ACCEPTED_WITH_ISSUE' : 'LOAD_POD_ACCEPTED',
          fields: {
            ...reviewFields,
            shortageOrDamage: issue,
            deliveryIssueDetails: trigger === 'pod_issue' ? (input.issueDetails ?? null) : null,
            // A fresh issue needs a fresh resolution.
            deliveryIssueSettledAt: null,
            deliveryIssueSettledBy: null,
            deliveryIssueSettlementNote: null,
          },
          metadata: { podDecision: decision, shortageOrDamage: issue },
        });
      }

      await this.documents.decidePod(
        tenantId,
        loadId,
        actorId,
        decision === 'accepted' ? 'approved' : 'rejected',
        reason ?? null,
      );
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'POD_REVIEWED',
        'pending',
        decision,
        decision === 'rejected'
          ? { reason }
          : { shortageOrDamage: issue, issueDetails: input.issueDetails ?? null },
      );
      if (decision === 'rejected') {
        await this.auditService.log({
          tenantId,
          userId: actorId,
          action: 'LOAD_POD_REJECTED',
          resourceType: 'load',
          oldData: { id: loadId, podStatus: 'pending' },
          newData: { id: loadId, podStatus: decision, reason },
        });
      }
      // LS_N_0041 (accepted) / LS_N_0040 (rejected).
      await this.onLoadEvent?.({
        kind: 'pod_reviewed',
        tenantId,
        loadId,
        decision,
        at: reviewedAt,
      });

      // Own fleet closes from Delivered — nothing to invoice or pay.
      if (updated.status === 'delivered_ok') {
        return await this.stageService.closeIfReady(tenantId, actorId, updated);
      }
      return updated;
    } catch (error) {
      rethrow(error, 'Failed to review E-POD');
    }
  }

  /** Loadsmart's Tracking team approved the loading papers — the load can move to Loaded. */
  async markLoadsmartPapersApproved(
    tenantId: string,
    actorId: string,
    loadId: string,
  ): Promise<void> {
    await this.repository.update(tenantId, loadId, {
      lsPapersApprovedAt: new Date(),
      updatedBy: actorId,
    });
  }

  /** Own transporter / indent, stage 11: the shipper uploads the transporter's invoice
   *  (`transporter_invoice_uploaded`, from Delivered). The balance is recorded against it next. */
  async uploadTransporterInvoice(
    tenantId: string,
    actorId: string,
    actorRole: string,
    loadId: string,
    input: TransporterInvoiceInput,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      await this.assertLoadDocumentUpload(tenantId, actorRole, input.fileKey, 'loads/invoice');
      const invoiceFields: UpdateLoadData = {
        transporterInvoiceFileKey: input.fileKey,
        transporterInvoiceNumber: input.invoiceNumber ?? null,
        transporterInvoiceAmount: input.amount === undefined ? null : String(input.amount),
      };
      // Checked before the file is kept, so a refused move leaves nothing behind.
      const decision = decideStage(load, 'transporter_invoice_uploaded', 'shipper', invoiceFields);
      if (!decision.ok) {
        throw new ConflictError(decision.message, {
          code: decision.code,
          missing: decision.missing,
        });
      }
      const withInvoice = await this.documents.save(
        tenantId,
        load,
        { ...invoiceFields, updatedBy: actorId },
        documentActor(actorId),
      );
      const updated = await this.stageService.transition({
        tenantId,
        loadId,
        trigger: 'transporter_invoice_uploaded',
        actorId,
        load: withInvoice,
        auditAction: 'LOAD_TRANSPORTER_INVOICE_UPLOADED',
        metadata: { invoiceNumber: input.invoiceNumber ?? null, amount: input.amount ?? null },
      });
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'TRANSPORTER_INVOICE_UPLOADED',
        null,
        input.invoiceNumber ?? null,
        { amount: input.amount ?? null },
      );
      return updated;
    } catch (error) {
      rethrow(error, "Failed to upload the transporter's invoice");
    }
  }

  /** Delivered with issues -> Delivered without issues: damage, shortage or pilferage noted on
   *  the POD has been settled (own fleet: handled internally; market/indent: settled with the
   *  transporter). Then closes the load if nothing else is pending. */
  async settleDeliveryIssue(
    tenantId: string,
    actorId: string,
    loadId: string,
    note: string,
    viaClaim = false,
    deduction?: IssueDeductionInput,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      assertNotLoadsmartClaim(load, viaClaim);
      if (load.status !== 'delivered_with_issues') {
        throw new ConflictError('This load has no delivery issue to settle');
      }
      // Own transporter / indent: "the resolution records whether there is a deduction and its
      // amount" — it comes off the balance due.
      const transporterRoute = load.route === 'own_transporter' || load.route === 'indent';
      let deductionAmount: string | null = null;
      if (transporterRoute) {
        if (deduction?.hasDeduction === undefined) {
          throw new ValidationError('Say whether there is a deduction from the transporter');
        }
        if (deduction.hasDeduction) {
          if (!deduction.amount || deduction.amount <= 0) {
            throw new ValidationError('Add the deduction amount');
          }
          deductionAmount = deduction.amount.toFixed(2);
        }
      } else if (deduction?.hasDeduction) {
        throw new ValidationError(
          'A deduction is recorded only on own-transporter and indent loads',
        );
      }
      const settled = await this.stageService.transition({
        tenantId,
        loadId,
        trigger: 'issue_resolved',
        actorId,
        load,
        auditAction: 'LOAD_DELIVERY_ISSUE_SETTLED',
        fields: {
          deliveryIssueSettledAt: new Date(),
          deliveryIssueSettledBy: actorId,
          deliveryIssueSettlementNote: note,
          deliveryIssueDeductionAmount: deductionAmount,
        },
      });
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'DELIVERY_ISSUE_SETTLED',
        load.shortageOrDamage,
        null,
        { note, deduction: deductionAmount },
      );
      return await this.stageService.closeIfReady(tenantId, actorId, settled);
    } catch (error) {
      rethrow(error, 'Failed to settle delivery issue');
    }
  }

  /** Driver-app "Report An Issue" — a load's own driver flags a problem (breakdown, halt,
   *  accident, etc.) while carrying it. `driverOwnerId` is set only by driver-portal's
   *  self-service call — see updateStatus's doc comment above for the ownership-check/audit-FK
   *  reasoning; identical here.
   *
   *  Unlike updateStatus/uploadPod there is no staff-initiated equivalent of this action to
   *  disambiguate from, so `userId` stays null unconditionally and one audit action name
   *  (LOAD_ISSUE_REPORTED) covers it — no `_BY_DRIVER` variant needed. */
  async reportIssue(
    tenantId: string,
    actorId: string,
    actorRole: string,
    loadId: string,
    input: ReportLoadIssueInput,
    driverOwnerId?: string,
  ): Promise<LoadIssueReportEntity> {
    try {
      const load = await this.assertExists(tenantId, loadId);
      if (driverOwnerId && load.driverId !== driverOwnerId) {
        throw new NotFoundError(`Load ${loadId} not found`);
      }
      if (COMPLETED_LOAD_STATUSES.includes(load.status)) {
        throw new ConflictError('Cannot report an issue on a load that is already closed');
      }

      for (const key of input.photoFileKeys ?? []) {
        await this.assertLoadDocumentUpload(tenantId, actorRole, key, 'loads/issue');
      }

      const issue = await this.loadIssueRepository.create({
        tenantId,
        loadId,
        reportedBy: actorId,
        ...input,
      });

      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'ISSUE_REPORTED',
        null,
        input.category,
        { category: input.category, photoCount: input.photoFileKeys?.length ?? 0 },
      );
      await this.auditService.log({
        tenantId,
        userId: null,
        action: 'LOAD_ISSUE_REPORTED',
        resourceType: 'load',
        newData: { id: issue.id, loadId, category: input.category, driverId: actorId },
      });
      // LS_N_0054 (breakdown) / LS_N_0037 (accident, road block, …) — the notifier decides.
      await this.onIssueReported?.({
        tenantId,
        loadId,
        issueId: issue.id,
        category: input.category,
      });

      return issue;
    } catch (error) {
      rethrow(error, 'Failed to report load issue');
    }
  }

  /** A trip with an unresolved accident/breakdown can't move forward until staff resolve it. */
  private async assertNotHalted(tenantId: string, loadId: string): Promise<void> {
    const open = buildIncident(
      await this.loadIssueRepository.findLatestOpenByLoad(tenantId, loadId),
    );
    if (open?.halted) {
      throw new ConflictError('This trip is on hold because of a reported incident');
    }
  }

  /** Staff marks a driver-reported issue resolved — releases the hold if it was an accident or
   *  breakdown. Idempotent-safe: resolving an already-resolved report is a 404, not a re-stamp. */
  async resolveIssue(
    tenantId: string,
    actorId: string,
    loadId: string,
    issueId: string,
  ): Promise<LoadIssueReportEntity> {
    try {
      await this.assertExists(tenantId, loadId);
      const issue = await this.loadIssueRepository.resolve(tenantId, loadId, issueId, actorId);
      if (!issue) throw new NotFoundError(`Open issue ${issueId} not found on load ${loadId}`);

      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOAD_ISSUE_RESOLVED',
        resourceType: 'load',
        newData: { id: issue.id, loadId, category: issue.category },
      });
      return issue;
    } catch (error) {
      rethrow(error, 'Failed to resolve load issue');
    }
  }

  async listIssues(tenantId: string, loadId: string): Promise<LoadIssueReportEntity[]> {
    try {
      return await this.loadIssueRepository.listByLoad(tenantId, loadId);
    } catch (error) {
      rethrow(error, 'Failed to list load issues');
    }
  }

  /** Wide-relation counterpart to assertExists, for the read-only Detail path only — see
   *  load.repository.ts's findDetailById doc comment for why this isn't just assertExists. */
  private async assertDetailExists(tenantId: string, id: string): Promise<LoadEntity> {
    try {
      const load = await this.repository.findDetailById(tenantId, id);
      if (!load) throw new NotFoundError(`Load ${id} not found`);
      return load;
    } catch (error) {
      rethrow(error, 'Failed to verify load exists');
    }
  }

  /** Load Detail / Trip Detail — status, documents (resolved to download URLs), payments, the
   *  full chronological activity timeline (with actor names), the route's stage stepper, and
   *  the next-action panel (next stage, tracking/advance-due info). This is the single trip
   *  detail screen — see loads.openapi.ts.
   *
   *  `driverOwnerId` is set only by driver-portal's self-service call — see updateStatus's doc
   *  comment above for the ownership-check reasoning; identical here (masked as not-found, no
   *  audit/activity write happens on a read so there's no FK concern to branch on). */
  async get(
    tenantId: string,
    actorRole: string,
    loadId: string,
    driverOwnerId?: string,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<LoadDetailView> {
    try {
      const load = await this.assertDetailExists(tenantId, loadId);
      if (driverOwnerId && load.driverId !== driverOwnerId) {
        throw new NotFoundError(`Load ${loadId} not found`);
      }
      const [timeline, payments, loadWithUrls, fleetOwner, openIssue, assignedBy, licenceKeys] =
        await Promise.all([
          this.loadActivityService.listByLoad(tenantId, loadId),
          this.loadPaymentRepository.listByLoad(tenantId, loadId),
          this.withDocumentDownloadUrls(tenantId, actorRole, load),
          this.authService.getFleetOwner(tenantId),
          this.loadIssueRepository.findLatestOpenByLoad(tenantId, loadId),
          this.loadActivityService.assignedByLoad([load]),
          load.driverId
            ? this.repository.findDriverLicenceKeys(load.driverId)
            : { dlFrontKey: null, dlBackKey: null },
        ]);
      const incident = buildIncident(openIssue);
      // Licence keys come from the load's own driver, so they're signed directly — self-registered
      // and imported drivers' photos can have no tenant-scoped storage.files row for getByKey.
      const signLicenceKey = async (key: string | null) =>
        key ? this.storageService.getPresignedDownloadUrlForKey(key) : null;
      const [dlFrontUrl, dlBackUrl] = await Promise.all([
        signLicenceKey(licenceKeys.dlFrontKey),
        signLicenceKey(licenceKeys.dlBackKey),
      ]);

      return {
        load: {
          ...loadWithUrls,
          // Load detail is open to every tenant seat — the embedded driver and transporter rows
          // never carry pay or bank data here (those have their own gated screens).
          driver: loadWithUrls.driver ? withoutDriverPay(loadWithUrls.driver) : loadWithUrls.driver,
          transporter: loadWithUrls.transporter
            ? (withoutTransporterBank(loadWithUrls.transporter) as typeof loadWithUrls.transporter)
            : loadWithUrls.transporter,
          dlFrontKey: dlFrontUrl,
          dlBackKey: dlBackUrl,
        },
        ownerPhoneNumber: fleetOwner.owner?.phoneNumber ?? null,
        dispatchPhoneNumber: fleetOwner.dispatch?.phoneNumber ?? null,
        fleetOwner,
        assignedBy: assignedBy.get(load.id) ?? null,
        documentKeys: {
          invoiceFileKey: load.invoiceFileKey,
          ewayBillFileKey: load.ewayBillFileKey,
          elrFileKey: load.elrFileKey,
          podFileKey: load.podFileKey,
          podBackFileKey: load.podBackFileKey,
          weighingSlipFileKey: load.weighingSlipFileKey,
          loadingPhotoFileKeys: load.loadingPhotoFileKeys,
          ...licenceKeys,
        },
        timeline,
        payments,
        ewayBillExpiry: this.getEwayBillExpiry(load),
        stepper: buildStepper(load, locale, incident),
        nextAction: buildNextAction(load, locale),
        incident,
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch load');
    }
  }

  /** The tenant a driver's load lives in, for the driver portal's per-load routes — the driver can
   *  be linked to several tenants, so it is derived from the load. Not-found when the load isn't
   *  this driver's in any of their tenants (same masking as the ownership checks below). */
  async resolveDriverLoadTenant(
    driverId: string,
    tenantIds: string[],
    loadId: string,
  ): Promise<string> {
    try {
      const tenantId = await this.repository.findTenantIdForDriverLoad(loadId, driverId, tenantIds);
      if (!tenantId) throw new NotFoundError(`Load ${loadId} not found`);
      return tenantId;
    } catch (error) {
      rethrow(error, 'Failed to resolve load');
    }
  }

  /** Driver-app "Trip Done" detail screen — a lean, single-pickup/single-drop summary for a
   *  completed trip, distinct from get() above (whose payments/stepper/nextAction are staff
   *  planning-oriented and meaningless once a trip is closed). See TripDoneDetail's doc comment
   *  for the single-drop scope. Ownership check identical to get()'s driverOwnerId branch. */
  async getMyTripDetail(
    tenantId: string,
    driverId: string,
    loadId: string,
  ): Promise<TripDoneDetail> {
    try {
      const load = await this.assertDetailExists(tenantId, loadId);
      if (load.driverId !== driverId) {
        throw new NotFoundError(`Load ${loadId} not found`);
      }
      return toTripDoneDetail(load, (await this.tripAssignments([load])).get(load.id));
    } catch (error) {
      rethrow(error, 'Failed to fetch trip detail');
    }
  }

  /** Driver-app "Show papers" screen — the load's E-way bill / LR / Invoice with signed download
   *  URLs, plus the vehicle and route header. Ownership check identical to getMyTripDetail's;
   *  any load status is allowed, since the papers matter most while the trip is in transit. */
  async getLoadDocuments(tenantId: string, driverId: string, loadId: string): Promise<LoadPapers> {
    try {
      const load = await this.assertDetailExists(tenantId, loadId);
      if (load.driverId !== driverId) {
        throw new NotFoundError(`Load ${loadId} not found`);
      }
      const resolveNullable = (key: string | null) =>
        key ? this.resolveDownloadUrl(tenantId, 'driver', key) : Promise.resolve(null);
      const [eway_bill, lr, invoice] = await Promise.all([
        resolveNullable(load.ewayBillFileKey),
        resolveNullable(load.elrFileKey),
        resolveNullable(load.invoiceFileKey),
      ]);
      return toLoadPapers(load, { eway_bill, lr, invoice }, this.getEwayBillExpiry(load));
    } catch (error) {
      rethrow(error, 'Failed to fetch load documents');
    }
  }

  /** Trips Home-page list — one row per load with its route/customer/vehicle-source resolved,
   *  plus tenant-wide Active/Completed tab counts (independent of which group, if any, was
   *  requested) so the UI can render both tab badges from a single call. */
  /** Set by the loads module once LoadPaymentService exists: what a list row shows as due. */
  private amountDueResolver?: (load: LoadEntity) => Promise<AmountDue | null>;

  setAmountDueResolver(resolver: (load: LoadEntity) => Promise<AmountDue | null>): void {
    this.amountDueResolver = resolver;
  }

  async list(
    tenantId: string | string[],
    input: ListLoadsInput,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<ListTripsResult> {
    try {
      const { requisitionId, postingType, route, transporterId, vehicleId, driverId, search } =
        input;
      const [[items, total], counts] = await Promise.all([
        this.repository.list(tenantId, input),
        this.repository.countByGroup(tenantId, {
          requisitionId,
          postingType,
          route,
          transporterId,
          vehicleId,
          driverId,
          search,
        }),
      ]);
      const assignments = await this.tripAssignments(items);
      const due = this.amountDueResolver
        ? await Promise.all(items.map((load) => this.amountDueResolver!(load)))
        : items.map(() => null);
      return {
        ...paginate(
          items.map((load, index) => ({
            ...toTripListRow(load, locale, assignments.get(load.id)),
            amountDue: due[index],
          })),
          total,
          input,
        ),
        counts,
      };
    } catch (error) {
      rethrow(error, 'Failed to list loads');
    }
  }

  /** Home Live Loads — every load that isn't closed, newest first, one scroll page at a time. */
  async listLive(
    tenantId: string | string[],
    { limit, cursor }: ListLiveLoadsInput,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<ListLiveLoadsResult> {
    const after = cursor ? decodeLiveLoadsCursor(cursor) : null;
    if (cursor && !after) throw new ValidationError('Invalid cursor');
    try {
      const rows = await this.repository.listLive(tenantId, { limit, after });
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      const assignments = await this.tripAssignments(page);
      return {
        items: page.map((load) => ({
          ...toTripListRow(load, locale, assignments.get(load.id)),
          progressPercent: progressPercentFor(load),
        })),
        nextCursor: hasMore && last ? encodeLiveLoadsCursor(last) : null,
        hasMore,
      };
    } catch (error) {
      rethrow(error, 'Failed to list live loads');
    }
  }

  /** Driver-app "Trips Done" screen — see TripsDoneResult's doc comment for scope/omissions. */
  async getMyTripsDone(
    tenantId: string | string[],
    driverId: string,
    input: PaginationInput,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<TripsDoneResult> {
    try {
      const [[items, total], stats] = await Promise.all([
        this.repository.list(tenantId, { ...input, driverId, group: 'completed' }),
        this.repository.getCompletedStatsForDriver(tenantId, driverId),
      ]);
      const epodVerifiedPercentage =
        stats.totalCompleted === 0
          ? 0
          : Math.round((stats.podVerifiedCount / stats.totalCompleted) * 100);
      const assignments = await this.tripAssignments(items);
      return {
        ...paginate(
          items.map((load) => toTripListRow(load, locale, assignments.get(load.id))),
          total,
          input,
        ),
        totalTrips: stats.totalCompleted,
        epodVerifiedPercentage,
      };
    } catch (error) {
      rethrow(error, 'Failed to list completed trips');
    }
  }
}
