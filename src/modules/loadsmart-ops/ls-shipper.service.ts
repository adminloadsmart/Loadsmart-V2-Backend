import { IsNull } from 'typeorm';
import { SHIPPER_PRECEDENCE_TYPES } from '../loads/documents/load-document.types';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { isLoadsmartLoad } from '../loads/utils/load-stages';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { LoadActivityService } from '../loads/activity/load-activity.service';
import { LoadEntity } from '../loads/entities/load.entity';
import { LoadPaymentRepository } from '../loads/payments/load-payment.repository';
import { LoadRepository } from '../loads/core/load.repository';
import { LoadMemoRepository } from '../loads/memo/load-memo.repository';
import { LoadChargeEntity } from '../loads/money/load-charge.entity';
import { assertConfirmedUpload } from '../loads/documents/upload-check';
import { LoadClaimEntity } from './entities/load-claim.entity';
import { LoadsmartRepository } from './loadsmart.repository';
import { ChargeType, LOADING_SIDE_HEADS } from './loadsmart.types';
import { LsServiceBase } from './ls-base';
import { LsStaffNotifier } from './ls-staff-notifier';
import { chargeNeedsAdmin } from './ls-tracking.service';
import { LS_MONEY_APPROVE } from '../../shared/constants/permissions';
import { SettingsReader } from '../settings/settings.types';
import {
  AddChargeInput,
  BundleDocument,
  ChargeDecisionInput,
  ChargeStageRule,
  ClaimValueInput,
  LoadDocumentKey,
} from './loadsmart.interface';

/** When each charge can be added: loading at the gate, unloading at the drop, detention any time
 *  the truck is held on the trip. */
const CHARGE_STAGES: Record<ChargeType, ChargeStageRule> = {
  loading: {
    statuses: ['reached_loading', 'loaded'],
    message: 'The loading charge is added at the loading point',
  },
  unloading: {
    statuses: ['reached_unloading', 'delivered_ok', 'delivered_with_issues'],
    message: 'The unloading charge is settled at the drop',
  },
  detention: {
    statuses: [
      'in_transit_loading',
      'reached_loading',
      'loaded',
      'in_transit_unloading',
      'reached_unloading',
      'delivered_ok',
      'delivered_with_issues',
    ],
    message: 'Detention is added while the truck is on the trip',
  },
};

/**
 * The shipper's side of a Loadsmart load, on the shipper's own loads router: add the loading,
 * unloading and detention charges, add the unloading contact and the claim value, see the
 * invoice, and download every document on the load. Approving the papers, settling the claim and
 * generating the invoice run through LsSourcingService / LsSettlementService.
 */
export class LsShipperService extends LsServiceBase {
  constructor(
    repository: LoadsmartRepository,
    loadActivityService: LoadActivityService,
    auditService: AuditService,
    private readonly loadRepository: LoadRepository,
    private readonly loadPaymentRepository: LoadPaymentRepository,
    private readonly memoRepository: LoadMemoRepository,
    private readonly storageService: StorageService,
    /** Loadsmart's bank account for Pay invoice (Super Admin → Settings). */
    private readonly settings: SettingsReader,
    private readonly notifier: LsStaffNotifier,
    now?: () => Date,
  ) {
    super(repository, loadActivityService, auditService, now);
  }

  private async assertLoad(tenantId: string, loadId: string): Promise<LoadEntity> {
    const load = await this.loadRepository.findById(tenantId, loadId);
    if (!load) throw new NotFoundError(`Load ${loadId} not found`);
    return load;
  }

  private async assertLoadsmartLoad(tenantId: string, loadId: string): Promise<LoadEntity> {
    const load = await this.assertLoad(tenantId, loadId);
    if (!isLoadsmartLoad(load)) throw new ConflictError('This is not a Loadsmart load');
    return load;
  }

  /** The load's charges, each with what it is paid with (loading-side charges with the advance,
   *  the rest with the balance) and a link to its proof. */
  async listCharges(tenantId: string, loadId: string, role = 'org_admin') {
    await this.assertLoad(tenantId, loadId);
    const charges = await this.repository.listCharges(tenantId, loadId);
    const urlOf = (key: string | null) =>
      key
        ? this.storageService
            .getByKey({ tenantId, role }, key)
            .then((file) => file.downloadUrl)
            .catch(() => null)
        : Promise.resolve(null);
    return Promise.all(
      charges.map(async (charge) => ({
        ...charge,
        paidWith: LOADING_SIDE_HEADS.includes(charge.chargeType)
          ? ('advance' as const)
          : ('balance' as const),
        proofUrl: await urlOf(charge.proofFileKey),
        queryAttachmentUrl: await urlOf(charge.queryFileKey),
        replyAttachmentUrl: await urlOf(charge.replyFileKey),
      })),
    );
  }

  /** "Approve charges of ₹4,850" — several decisions in one go; each is applied in turn and the
   *  first that fails stops the rest. */
  async decideCharges(
    tenantId: string,
    actorId: string,
    loadId: string,
    decisions: (ChargeDecisionInput & { chargeId: string })[],
    actorRole = 'org_admin',
  ): Promise<LoadChargeEntity[]> {
    const decided: LoadChargeEntity[] = [];
    for (const { chargeId, ...input } of decisions) {
      decided.push(await this.decideCharge(tenantId, actorId, loadId, chargeId, input, actorRole));
    }
    return decided;
  }

  /** "Approves the loading charge if Loadsmart raises one" — and detention, and unloading. */
  async decideCharge(
    tenantId: string,
    actorId: string,
    loadId: string,
    chargeId: string,
    input: ChargeDecisionInput,
    actorRole = 'org_admin',
  ): Promise<LoadChargeEntity> {
    try {
      await this.assertLoadsmartLoad(tenantId, loadId);
      const charge = await this.repository.charges.findOneBy({ id: chargeId, tenantId, loadId });
      if (!charge) throw new NotFoundError(`Charge ${chargeId} not found`);
      // A queried charge can still be approved or rejected (the shipper may not wait for the
      // answer); asking again waits for Loadsmart's answer first.
      const decidable =
        charge.status === 'raised' || (charge.status === 'queried' && input.decision !== 'queried');
      if (!decidable) {
        throw new ConflictError(
          charge.status === 'queried'
            ? 'You already asked about this charge — Loadsmart will answer it'
            : `This charge is already ${charge.status}`,
        );
      }
      if (input.decision !== 'approved' && !input.reason) {
        throw new ValidationError(
          `reason is required to ${input.decision === 'queried' ? 'query' : 'reject'} a charge`,
        );
      }
      if (input.attachmentFileKey) {
        if (input.decision !== 'queried') {
          throw new ValidationError('An attachment can only be sent with a question');
        }
        await assertConfirmedUpload(
          this.storageService,
          tenantId,
          actorRole,
          input.attachmentFileKey,
          'loads/charge-proof',
        );
      }
      // Approving is the shipper's half: the charge then waits for Super Admin, and only an
      // admin-approved charge reaches the invoice and the carrier's pay.
      const result = await this.repository.charges.update(
        { id: chargeId, status: charge.status },
        input.decision === 'queried'
          ? {
              status: 'queried',
              queryReason: input.reason!,
              queriedAt: this.now(),
              queriedBy: actorId,
              queryFileKey: input.attachmentFileKey ?? null,
              // A new question starts a new thread — the last answer no longer applies.
              queryReply: null,
              repliedAt: null,
              repliedBy: null,
              replyTag: null,
              replyFileKey: null,
            }
          : {
              status: input.decision === 'approved' ? 'pending_admin' : input.decision,
              decidedBy: actorId,
              decidedAt: this.now(),
              rejectionReason: input.reason ?? null,
            },
      );
      if (!result.affected) throw new ConflictError('The charge changed — reload it');
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'LOADSMART_STEP',
        'raised',
        `${charge.chargeType}_charge_${input.decision}`,
        {
          chargeId,
          amount: charge.amount,
        },
      );
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LS_CHARGE_DECIDED',
        resourceType: 'load',
        newData: { loadId, chargeId, decision: input.decision },
      });
      const code = (await this.loadRepository.findById(tenantId, loadId))?.code ?? loadId;
      if (input.decision === 'approved') {
        await this.notifier.notifyPermission(
          [LS_MONEY_APPROVE],
          chargeNeedsAdmin(code, charge, charge.chargeType),
        );
      } else {
        await this.notifier.notifyUsers([charge.raisedBy], {
          type: `charge.shipper_${input.decision}`,
          title: `Shipper ${input.decision === 'queried' ? 'queried' : 'rejected'} a charge — ${code}`,
          body: `The ${charge.chargeType.replace(/_/g, ' ')} charge of ₹${charge.amount} on ${code}: ${input.reason}.`,
          loadId,
          metadata: { chargeId, decision: input.decision, reason: input.reason },
        });
      }
      return (await this.repository.charges.findOneBy({ id: chargeId }))!;
    } catch (error) {
      rethrow(error, 'Failed to decide the charge');
    }
  }

  /** A loading, unloading or detention charge, entered by the shipper — it counts as approved
   *  and goes on Loadsmart's invoice. "Settles the unloading charge: approves the amount asked at
   *  the gate, or enters the amount agreed with the receiver." */
  async addCharge(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: AddChargeInput,
  ): Promise<LoadChargeEntity> {
    try {
      const load = await this.assertLoadsmartLoad(tenantId, loadId);
      const rule = CHARGE_STAGES[input.chargeType];
      if (!rule.statuses.includes(load.status)) throw new ConflictError(rule.message);
      const charge = await this.repository.charges.save(
        this.repository.charges.create({
          tenantId,
          loadId,
          chargeType: input.chargeType,
          amount: String(input.amount),
          note: input.note ?? null,
          status: 'approved',
          raisedByParty: 'shipper',
          raisedBy: actorId,
          decidedBy: actorId,
          decidedAt: this.now(),
        }),
      );
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'LOADSMART_STEP',
        null,
        `${input.chargeType}_charge_entered`,
        {
          chargeId: charge.id,
          amount: input.amount,
        },
      );
      return charge;
    } catch (error) {
      rethrow(error, 'Failed to add the charge');
    }
  }

  /** "The shipper adds the claim value" on a Loadsmart load delivered with issues. */
  async addClaimValue(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: ClaimValueInput,
  ): Promise<LoadClaimEntity> {
    try {
      await this.assertLoadsmartLoad(tenantId, loadId);
      const claim = await this.repository.findClaim(loadId);
      if (!claim || claim.status !== 'open') throw new ConflictError('This load has no open claim');
      await this.repository.claims.update(
        { id: claim.id },
        { claimValue: String(input.claimValue), shipperNote: input.note ?? null },
      );
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'LOADSMART_STEP',
        null,
        'claim_value_added',
        {
          claimValue: input.claimValue,
        },
      );
      return (await this.repository.findClaim(loadId))!;
    } catch (error) {
      rethrow(error, 'Failed to add the claim value');
    }
  }

  async getClaim(tenantId: string, loadId: string): Promise<LoadClaimEntity | null> {
    await this.assertLoad(tenantId, loadId);
    return this.repository.findClaim(loadId);
  }

  /** The shipper's own Loadsmart load — what a shipper-side action on its invoice checks first. */
  async assertOwnLoadsmartLoad(tenantId: string, loadId: string): Promise<void> {
    await this.assertLoadsmartLoad(tenantId, loadId);
  }

  async getInvoice(tenantId: string, role: string, loadId: string) {
    await this.assertLoadsmartLoad(tenantId, loadId);
    const invoice = await this.repository.findInvoice(tenantId, loadId);
    if (!invoice) throw new NotFoundError("Loadsmart's invoice for this load isn't generated yet");
    const downloadUrl = invoice.fileKey
      ? (await this.storageService.getByKey({ tenantId, role }, invoice.fileKey)).downloadUrl
      : null;
    const { values } = await this.settings.current();
    // Pay invoice: where to pay, what is still open, and when it falls due.
    return {
      invoice,
      downloadUrl,
      payTo: values.loadsmartPayee,
      openAmount: invoice.openAmount ?? invoice.balanceDue,
      dueDate: invoice.dueDate,
      creditDays: invoice.creditDays,
    };
  }

  /** "The load memo, documents and payments stay on the load to download." */
  async documentsBundle(tenantId: string, role: string, loadId: string) {
    try {
      const load = await this.assertLoad(tenantId, loadId);
      const documentKeys: LoadDocumentKey[] = [
        { type: 'elr', label: 'e-LR', key: load.elrDocumentFileKey },
        { type: 'signed_lr', label: 'Signed LR', key: load.elrFileKey },
        { type: 'invoice', label: 'Goods invoice', key: load.invoiceFileKey },
        { type: 'eway_bill', label: 'E-way bill', key: load.ewayBillFileKey },
        { type: 'weighing_slip', label: 'Weighing slip', key: load.weighingSlipFileKey },
        { type: 'pod_front', label: 'POD front', key: load.podFileKey },
        { type: 'pod_back', label: 'POD back', key: load.podBackFileKey },
        {
          type: 'transporter_invoice',
          label: "Transporter's invoice",
          key: load.transporterInvoiceFileKey,
        },
      ];
      const invoice = await this.repository.findInvoice(tenantId, loadId);
      if (invoice?.fileKey) {
        documentKeys.push({
          type: 'loadsmart_invoice',
          label: `Loadsmart invoice ${invoice.invoiceNumber}`,
          key: invoice.fileKey,
        });
      }
      const payments = await this.loadPaymentRepository.listByLoad(tenantId, loadId);
      // Loadsmart's own copy of a paper the shipper hasn't uploaded is for reference only.
      const referenceTypes = new Set(
        (
          await this.repository.loadDocuments.find({
            where: { loadId, source: 'console', supersededAt: IsNull() },
            select: { docType: true },
          })
        )
          .map((doc) => doc.docType)
          .filter((type) => SHIPPER_PRECEDENCE_TYPES.includes(type)),
      );

      const documents: BundleDocument[] = [];
      for (const documentKey of documentKeys) {
        if (!documentKey.key) continue;
        const { downloadUrl } = await this.storageService.getByKey(
          { tenantId, role },
          documentKey.key,
        );
        documents.push({
          type: documentKey.type,
          label: documentKey.label,
          fileKey: documentKey.key,
          downloadUrl,
          ...(referenceTypes.has(documentKey.type as never) ? { referenceOnly: true } : {}),
        });
      }
      return {
        loadId,
        loadCode: load.code,
        memo: await this.memoRepository.findLatest(tenantId, loadId),
        payments,
        documents,
      };
    } catch (error) {
      rethrow(error, 'Failed to build the documents bundle');
    }
  }
}
