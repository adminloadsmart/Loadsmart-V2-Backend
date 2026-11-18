import { DataSource } from 'typeorm';
import { CodeSequenceRepository } from '../loads/code-sequence/code-sequence.repository';
import { LoadMemoRepository } from '../loads/memo/load-memo.repository';
import { LoadPaymentRepository } from '../loads/payments/load-payment.repository';
import { LoadsmartRepository } from './loadsmart.repository';
import { LsSourcingService } from './ls-sourcing.service';
import { LsSettlementService } from './ls-settlement.service';
import { LsShipperService } from './ls-shipper.service';
import { LsPlacementService } from './ls-placement.service';
import { LsApprovalService } from './ls-approval.service';
import { LsTrackingService } from './ls-tracking.service';
import { LsStaffNotifier } from './ls-staff-notifier';
import { LsCallLogService } from './ls-call-log.service';
import { LS_SETTINGS_MANAGE } from '../../shared/constants/permissions';
import { LsCsService } from './ls-cs.service';
import { LsReceivablesService } from './ls-receivables.service';
import { LsPayablesService } from './ls-payables.service';
import { LsConsoleService } from './ls-console.service';
import { ConsoleRepository } from './console.repository';
import { LoadsmartOpsController, LoadsmartShipperController } from './loadsmart.controller';
import { createLoadsmartOpsRoutes, createLoadsmartShipperRoutes } from './loadsmart.routes';
import { LoadsmartOpsModuleDeps } from './loadsmart.interface';

/** Loadsmart loads — the ops console and the shipper's side. Built after the loads module; it
 *  hooks into posting (opens a sourcing per market load), bids (Loadsmart's bid accepted), stage
 *  moves (a claim when delivered with issues; lost when another truck is assigned) and the
 *  shipper's balance payment (the invoice's balance). */
export function createLoadsmartOpsModule(dataSource: DataSource, deps: LoadsmartOpsModuleDeps) {
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
    deps.settings,
    deps.loadDocumentService,
  );
  const settlement = new LsSettlementService(
    repository,
    deps.loadActivityService,
    deps.auditService,
    deps.loadRepository,
    deps.loadService,
    deps.loadStageService,
    deps.loadDocumentService,
    deps.storageService,
  );
  const staffNotifier = new LsStaffNotifier(repository);
  const loadPaymentRepository = new LoadPaymentRepository(dataSource);
  const codeSequenceRepository = new CodeSequenceRepository(dataSource);
  const shipper = new LsShipperService(
    repository,
    deps.loadActivityService,
    deps.auditService,
    deps.loadRepository,
    loadPaymentRepository,
    new LoadMemoRepository(dataSource),
    deps.storageService,
    deps.settings,
    staffNotifier,
  );

  // Placement (brokers, round robin, inbox, lost, memo) and Approval (post for a shipper).
  const placement = new LsPlacementService(
    repository,
    deps.loadActivityService,
    deps.auditService,
    deps.loadMemoService,
    deps.settings,
  );
  const approval = new LsApprovalService(
    dataSource,
    deps.loadPostingService,
    deps.storageService,
    deps.loadActivityService,
    deps.auditService,
  );

  // Tracking (charges, e-LR, carrier advance) and the advance's approval and payment.
  const tracking = new LsTrackingService(
    repository,
    deps.loadActivityService,
    deps.auditService,
    deps.storageService,
    deps.loadDocumentService,
    deps.elrService,
    staffNotifier,
  );

  const callLog = new LsCallLogService(
    repository,
    deps.loadActivityService,
    deps.auditService,
    deps.trackingClient,
  );

  // Delivery and money: CS claims, Receivables, Payables.
  const receivables = new LsReceivablesService(
    repository,
    deps.loadActivityService,
    deps.auditService,
    dataSource,
    deps.loadRepository,
    deps.loadStageService,
    loadPaymentRepository,
    codeSequenceRepository,
    deps.storageService,
    deps.settings,
    deps.loadDocumentService,
  );
  const cs = new LsCsService(
    repository,
    deps.loadActivityService,
    deps.auditService,
    dataSource,
    deps.loadRepository,
    deps.loadStageService,
    codeSequenceRepository,
    deps.storageService,
    deps.loadDocumentService,
    receivables,
  );
  const payables = new LsPayablesService(
    repository,
    deps.loadActivityService,
    deps.auditService,
    deps.loadRepository,
    deps.loadStageService,
    deps.settings,
    deps.storageService,
    deps.loadDocumentService,
  );

  // Cross-team read views: All loads, Super Admin approvals, analytics, live map.
  const consoleViews = new LsConsoleService(
    dataSource,
    repository,
    new ConsoleRepository(dataSource),
    deps.loadActivityService,
    loadPaymentRepository,
    deps.trackingClient,
    deps.settings,
    deps.loadCancelService,
  );

  // Hooks into the loads module: a market post (or a rejected indent) opens a sourcing, which goes
  // to the next Placement member on duty.
  deps.postingHooks.onMarketLoadsPosted = async (loads) => {
    await sourcing.createForLoads(loads);
    await placement.assignNew(loads);
  };
  // Edited before any bid: the sourcing re-checks what the posting is missing.
  deps.postingHooks.onMarketLoadsEdited = async (loads) => {
    await sourcing.refreshForEditedLoads(loads);
  };
  deps.loadBidService.setLoadsmartBidAcceptedHook(sourcing.onLoadsmartBidAccepted);
  deps.loadBidService.setLoadsmartBidEventHooks({
    countered: sourcing.onLoadsmartBidCountered,
    rejected: sourcing.onLoadsmartBidRejected,
  });
  deps.loadPaymentService.setLoadsmartBilling({ balanceDueOf: receivables.balanceDueOf });
  deps.stageHooks.push(settlement.onStageEntered, async (load, to) => {
    if (load.route === 'loadsmart' && (to === 'delivered_ok' || to === 'delivered_with_issues')) {
      await payables.openTracker(load);
    }
    if (to === 'truck_assigned' && load.route !== 'loadsmart') {
      await sourcing.markLostIfAssignedElsewhere(load);
    }
    // The shipper cancelled the load (Super Admin approved, if Loadsmart had won it): Loadsmart's
    // side closes too.
    if (to === 'cancelled') await sourcing.markCancelled(load);
  });

  // The e-way bill alert (shipper's LS_N_0025) also reaches Super Admin and the load's Tracking owner.
  const notifyEwayBillAtRisk = async (
    _tenantId: string,
    context: { loadId: string; expiresAt: string; etaAt?: string | null; code?: string },
  ) => {
    const sourcing = await repository.findSourcingByLoad(context.loadId);
    if (!sourcing) return; // not a Loadsmart load
    const code = sourcing.load?.code ?? context.code ?? context.loadId;
    const notice = {
      type: 'eway_bill.at_risk',
      title: `E-way bill may expire before delivery — ${code}`,
      body: context.etaAt
        ? `The ETA of ${code} is past its e-way bill's expiry (${context.expiresAt}).`
        : `${code} has no live ETA and its e-way bill expires at ${context.expiresAt}.`,
      loadId: context.loadId,
      metadata: { expiresAt: context.expiresAt, etaAt: context.etaAt ?? null },
    };
    await staffNotifier.notifyPermission([LS_SETTINGS_MANAGE], notice);
    await staffNotifier.notifyUsers([sourcing.trackingOwnerId], notice);
  };

  return {
    notifyEwayBillAtRisk,
    sourcingService: sourcing,
    settlementService: settlement,
    shipperService: shipper,
    opsRouter: createLoadsmartOpsRoutes(
      new LoadsmartOpsController(
        sourcing,
        settlement,
        placement,
        approval,
        tracking,
        cs,
        receivables,
        payables,
        consoleViews,
        staffNotifier,
        callLog,
      ),
    ),
    shipperRouter: createLoadsmartShipperRoutes(new LoadsmartShipperController(shipper)),
  };
}
