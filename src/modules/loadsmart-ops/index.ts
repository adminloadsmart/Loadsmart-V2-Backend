import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { NotificationTriggers } from '../notifications/notification-triggers';
import { CodeSequenceRepository } from '../loads/code-sequence.repository';
import { LoadActivityService } from '../loads/load-activity.service';
import { LoadBidService } from '../loads/bids/load-bid.service';
import { LoadMemoService } from '../loads/memo/load-memo.service';
import { LoadMemoRepository } from '../loads/memo/load-memo.repository';
import { LoadPaymentRepository } from '../loads/load-payment.repository';
import { LoadPaymentService } from '../loads/load-payment.service';
import { LoadRepository } from '../loads/load.repository';
import { LoadService } from '../loads/load.service';
import { LoadStageService } from '../loads/load-stage.service';
import { LoadVerificationService } from '../loads/verification/load-verification.service';
import { LoadPostingHooks } from '../loads/load-posting/load-posting.service';
import { LoadEntity } from '../loads/entities/load.entity';
import { LoadStatus } from '../loads/utils/loads.types';
import { LoadsmartRepository } from './loadsmart.repository';
import { LsSourcingService } from './ls-sourcing.service';
import { LsSettlementService } from './ls-settlement.service';
import { LsShipperService } from './ls-shipper.service';
import { LoadsmartOpsController, LoadsmartShipperController } from './loadsmart.controller';
import { createLoadsmartOpsRoutes, createLoadsmartShipperRoutes } from './loadsmart.routes';

/** Loadsmart loads — the ops console and the shipper's side. Built after the loads module; it
 *  hooks into posting (opens a sourcing per market load), bids (Loadsmart's bid accepted), stage
 *  moves (a claim when delivered with issues; lost when another truck is assigned) and the
 *  shipper's balance payment (the invoice's balance). */
export function createLoadsmartOpsModule(
  dataSource: DataSource,
  deps: {
    auditService: AuditService;
    storageService: StorageService;
    notificationTriggers: NotificationTriggers;
    loadActivityService: LoadActivityService;
    loadRepository: LoadRepository;
    loadService: LoadService;
    loadStageService: LoadStageService;
    loadBidService: LoadBidService;
    loadMemoService: LoadMemoService;
    loadVerificationService: LoadVerificationService;
    loadPaymentService: LoadPaymentService;
    postingHooks: LoadPostingHooks;
    stageHooks: ((load: LoadEntity, to: LoadStatus) => Promise<void>)[];
  },
) {
  const repository = new LoadsmartRepository(dataSource);
  const sourcing = new LsSourcingService(
    repository,
    deps.loadActivityService,
    deps.auditService,
    deps.loadService,
    deps.loadStageService,
    deps.loadBidService,
    deps.loadMemoService,
    deps.loadVerificationService,
  );
  const settlement = new LsSettlementService(
    repository,
    deps.loadActivityService,
    deps.auditService,
    dataSource,
    deps.loadRepository,
    deps.loadService,
    deps.loadStageService,
    deps.loadPaymentService,
    new LoadPaymentRepository(dataSource),
    new CodeSequenceRepository(dataSource),
    deps.storageService,
    deps.notificationTriggers,
  );
  const shipper = new LsShipperService(
    repository,
    deps.loadActivityService,
    deps.auditService,
    deps.loadRepository,
    new LoadPaymentRepository(dataSource),
    new LoadMemoRepository(dataSource),
    deps.storageService,
  );

  // Hooks into the loads module.
  deps.postingHooks.onMarketLoadsPosted = (loads) => sourcing.createForLoads(loads);
  deps.loadBidService.setLoadsmartBidAcceptedHook(sourcing.onLoadsmartBidAccepted);
  deps.loadPaymentService.setLoadsmartBilling({ balanceDueOf: settlement.balanceDueOf });
  deps.stageHooks.push(settlement.onStageEntered, async (load, to) => {
    if (to === 'truck_assigned' && load.sourceType !== 'loadsmart') {
      await sourcing.markLostIfAssignedElsewhere(load);
    }
  });

  return {
    sourcingService: sourcing,
    settlementService: settlement,
    shipperService: shipper,
    opsRouter: createLoadsmartOpsRoutes(new LoadsmartOpsController(sourcing, settlement)),
    shipperRouter: createLoadsmartShipperRoutes(
      new LoadsmartShipperController(shipper, sourcing, settlement),
    ),
  };
}
