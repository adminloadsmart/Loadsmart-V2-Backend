import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { StorageService } from '../storage/storage.service';
import { CustomerService } from '../customers/customer.service';
import { VehicleService } from '../masters/vehicle/vehicle.service';
import { TransporterService } from '../masters/transporter/transporter.service';
import { TruckTypeService } from '../masters/truck-type/truck-type.service';
import { LoadingPointService } from '../masters/loading-point/loading-point.service';
import { ProductService } from '../masters/product/product.service';

import { RequisitionRepository } from './requisitions/requisition.repository';
import { RequisitionService } from './requisitions/requisition.service';
import { CodeSequenceRepository } from './code-sequence/code-sequence.repository';
import { LoadRepository } from './core/load.repository';
import { LoadService } from './core/load.service';
import { LoadPaymentRepository } from './payments/load-payment.repository';
import { LoadPaymentService } from './payments/load-payment.service';
import { LoadIssueRepository } from './issues/load-issue.repository';
import { LoadActivityRepository } from './activity/load-activity.repository';
import { LoadActivityService } from './activity/load-activity.service';
import { LoadStageService } from './core/load-stage.service';
import { DispatchPlanningService } from './dispatch-planning/dispatch-planning.service';
import { LoadsController } from './core/loads.controller';
import { createLoadsProtectedRoutes } from './core/loads.routes';
import {
  LoadEventNotifier,
  NotificationTriggers,
  IssueReportedNotifier,
} from '../notifications/notifications.interface';
import { createLoadPostingModule } from './load-posting';
import { LoadPostingRepository } from './load-posting/load-posting.repository';
import { AssignmentComplianceService } from './compliance/assignment-compliance.service';
import { LoadEntity } from './entities/load.entity';
import { LoadStatus } from './utils/loads.types';
import { LoadBidRepository } from './bids/load-bid.repository';
import { LoadBidService } from './bids/load-bid.service';
import { LoadMemoRepository } from './memo/load-memo.repository';
import { LoadMemoService } from './memo/load-memo.service';
import { LoadSourcingController } from './sourcing/load-sourcing.controller';
import { createLoadSourcingRoutes } from './sourcing/load-sourcing.routes';
import { ElrService } from './elr/elr.service';
import { createJobQueue } from '../../jobs/queue-registry';
import { LoadAlertScheduler, LOAD_REMINDERS_QUEUE } from './alerts/load-alert-scheduler';
import { createTrackingSourceHook } from './core/tracking-source.hook';
import { createLoadRemindersWorker } from './workers/load-reminders.worker';
import { LoadVerificationRepository } from './verification/load-verification.repository';
import { LoadVerificationService } from './verification/load-verification.service';
import { DlVerificationClient } from '../../adapters/sarathi.client';
import { DriverTripNotifier } from './utils/load-alert.interface';
import { LoadStageHook } from './utils/load.interface';
import { LoadPostingHooks } from './load-posting/utils/load-posting.interface';
import { VehicleRegistryClient } from './utils/load-verification.interface';

export function createLoadsModule(
  dataSource: DataSource,
  deps: {
    auditService: AuditService;
    authService: AuthService;
    storageService: StorageService;
    customerService: CustomerService;
    vehicleService: VehicleService;
    transporterService: TransporterService;
    truckTypeService: TruckTypeService;
    loadingPointService: LoadingPointService;
    productService: ProductService;
    // LS_N_0017 — built in composition-root.ts, which also hands it to the notification resolvers.
    assignmentComplianceService: AssignmentComplianceService;
    onIssueReported?: IssueReportedNotifier;
    onLoadEvent?: LoadEventNotifier;
    /** VAHAN (ULIP) and Sarathi lookups for the load-time truck and driver checks. */
    vehicleRegistry: VehicleRegistryClient;
    dlVerificationClient: DlVerificationClient;
    /** No-tracking alerts: shipper reminders through the catalog, E-POD reminders to the driver app. */
    notificationTriggers: NotificationTriggers;
    driverTripNotifier: DriverTripNotifier;
  },
) {
  const loadActivityRepository = new LoadActivityRepository(dataSource);
  const loadActivityService = new LoadActivityService(loadActivityRepository, deps.authService);

  const requisitionRepository = new RequisitionRepository(dataSource);
  const loadRepository = new LoadRepository(dataSource);
  const loadPaymentRepository = new LoadPaymentRepository(dataSource);
  const loadIssueRepository = new LoadIssueRepository(dataSource);
  const codeSequenceRepository = new CodeSequenceRepository(dataSource);

  const requisitionService = new RequisitionService(
    dataSource,
    requisitionRepository,
    loadRepository,
    codeSequenceRepository,
    deps.customerService,
    deps.productService,
    deps.loadingPointService,
    deps.auditService,
  );

  // No-tracking alerts queued as a load enters a stage. Pickup time and drop ETA come from the
  // posting; a load planned from a requisition has neither, so it gets no arrival reminders.
  const loadBidRepository = new LoadBidRepository(dataSource);
  const remindersQueue = createJobQueue(LOAD_REMINDERS_QUEUE);
  const loadAlertScheduler = new LoadAlertScheduler(
    deps.notificationTriggers,
    remindersQueue,
    async (load) => {
      const posting = load.postingId
        ? await loadBidRepository.findPosting(load.tenantId, load.postingId)
        : null;
      return { pickupAt: posting?.pickupAt ?? null, dropDueAt: posting?.deliverByAt ?? null };
    },
  );

  // Everything that reacts to a stage move — the alert scheduler here, and the Loadsmart ops
  // module (built later, it pushes its own hook in composition-root.ts).
  const stageHooks: LoadStageHook[] = [
    loadAlertScheduler.onStageEntered,
    // Saves loads.tracking_source when a truck is assigned.
    createTrackingSourceHook(dataSource, loadRepository),
  ];
  const runStageHooks = async (load: LoadEntity, to: LoadStatus) => {
    for (const hook of stageHooks) {
      try {
        await hook(load, to);
      } catch (error) {
        console.warn(`[loads] stage hook failed for load ${load.id} at ${to}`, error);
      }
    }
  };
  const loadStageService = new LoadStageService(
    loadRepository,
    loadActivityService,
    deps.auditService,
    deps.vehicleService,
    deps.onLoadEvent,
    runStageHooks,
  );

  const loadService = new LoadService(
    loadRepository,
    deps.authService,
    loadPaymentRepository,
    loadIssueRepository,
    deps.transporterService,
    deps.storageService,
    loadActivityService,
    deps.auditService,
    loadStageService,
    deps.assignmentComplianceService,
    deps.driverTripNotifier,
    deps.onIssueReported,
    deps.onLoadEvent,
  );

  const loadPaymentService = new LoadPaymentService(
    loadPaymentRepository,
    loadRepository,
    deps.transporterService,
    loadActivityService,
    deps.auditService,
    loadStageService,
  );

  const dispatchPlanningService = new DispatchPlanningService(
    dataSource,
    requisitionRepository,
    loadRepository,
    codeSequenceRepository,
    deps.vehicleService,
    deps.truckTypeService,
    loadActivityService,
    deps.auditService,
    deps.driverTripNotifier,
    deps.assignmentComplianceService,
    new LoadPostingRepository(dataSource),
    deps.onLoadEvent,
    runStageHooks,
    (tenantId) => deps.authService.getFleetOwner(tenantId),
  );

  const elrService = new ElrService(
    dataSource,
    loadRepository,
    codeSequenceRepository,
    deps.storageService,
    loadActivityService,
    deps.auditService,
  );

  const controller = new LoadsController(
    requisitionService,
    dispatchPlanningService,
    loadService,
    loadPaymentService,
    loadActivityService,
    elrService,
  );
  const protectedRouter = createLoadsProtectedRoutes(controller);

  // Govt-portal checks of the truck and driver put on a load.
  const loadVerificationService = new LoadVerificationService(
    new LoadVerificationRepository(dataSource),
    deps.vehicleRegistry,
    deps.dlVerificationClient,
  );

  // Sourcing — bids, indent acceptance, driver and load memo (market and indent loads).
  const loadBidService = new LoadBidService(
    loadBidRepository,
    loadRepository,
    deps.transporterService,
    loadStageService,
    loadActivityService,
    deps.auditService,
    loadVerificationService,
    deps.onLoadEvent,
  );
  const loadMemoService = new LoadMemoService(
    new LoadMemoRepository(dataSource),
    loadBidRepository,
    loadRepository,
    loadActivityService,
    deps.auditService,
    loadVerificationService,
  );
  protectedRouter.use(
    createLoadSourcingRoutes(new LoadSourcingController(loadBidService, loadMemoService)),
  );

  // Post a load (load-posting/) — mounted under /post (this router itself sits at /v1/loads, so the full path is /v1/loads/post)
  // (the routes above are all /requisitions/* or /loads/*).
  // Filled in by the Loadsmart ops module (composition-root.ts), which is built after this one.
  const postingHooks: LoadPostingHooks = {};
  const loadPosting = createLoadPostingModule(dataSource, {
    auditService: deps.auditService,
    customerService: deps.customerService,
    vehicleService: deps.vehicleService,
    loadRepository,
    codeSequenceRepository,
    loadActivityService,
    driverNotifier: deps.driverTripNotifier,
    truckTypeService: deps.truckTypeService,
    assignmentComplianceService: deps.assignmentComplianceService,
    onLoadEvent: deps.onLoadEvent,
    onStageEntered: runStageHooks,
    hooks: postingHooks,
    fleetOwnerLookup: (tenantId) => deps.authService.getFleetOwner(tenantId),
  });
  protectedRouter.use('/post', loadPosting.router);

  return {
    requisitionService,
    loadService,
    loadStageService,
    loadBidService,
    loadMemoService,
    loadVerificationService,
    loadPaymentService,
    loadActivityService,
    dispatchPlanningService,
    loadPosting,
    postingHooks,
    stageHooks,
    loadRepository,
    elrService,
    protectedRouter,
    loadRemindersWorker: createLoadRemindersWorker(loadRepository, deps.driverTripNotifier),
  };
}
