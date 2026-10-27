import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { LoadActivityService } from '../loads/load-activity.service';
import { LoadEntity } from '../loads/entities/load.entity';
import { LoadStatus } from '../loads/utils/loads.types';
import { LoadPaymentRepository } from '../loads/load-payment.repository';
import { LoadRepository } from '../loads/load.repository';
import { LoadMemoRepository } from '../loads/memo/load-memo.repository';
import { LoadChargeEntity } from './entities/load-charge.entity';
import { LoadClaimEntity } from './entities/load-claim.entity';
import { LoadsmartRepository } from './loadsmart.repository';
import { ChargeType } from './loadsmart.types';
import { LsServiceBase } from './ls-base';

/** When each charge can be added: loading at the gate, unloading at the drop, detention any time
 *  the truck is held on the trip. */
const CHARGE_STAGES: Record<ChargeType, { statuses: readonly LoadStatus[]; message: string }> = {
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

export interface BundleDocument {
  type: string;
  label: string;
  fileKey: string;
  downloadUrl: string | null;
}

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
    if (load.sourceType !== 'loadsmart') throw new ConflictError('This is not a Loadsmart load');
    return load;
  }

  async listCharges(tenantId: string, loadId: string): Promise<LoadChargeEntity[]> {
    await this.assertLoad(tenantId, loadId);
    return this.repository.listCharges(tenantId, loadId);
  }

  /** "Approves the loading charge if Loadsmart raises one" — and detention, and unloading. */
  async decideCharge(
    tenantId: string,
    actorId: string,
    loadId: string,
    chargeId: string,
    input: { decision: 'approved' | 'rejected'; reason?: string },
  ): Promise<LoadChargeEntity> {
    try {
      await this.assertLoadsmartLoad(tenantId, loadId);
      const charge = await this.repository.charges.findOneBy({ id: chargeId, tenantId, loadId });
      if (!charge) throw new NotFoundError(`Charge ${chargeId} not found`);
      if (charge.status !== 'raised')
        throw new ConflictError(`This charge is already ${charge.status}`);
      if (input.decision === 'rejected' && !input.reason) {
        throw new ValidationError('reason is required when rejecting a charge');
      }
      await this.repository.charges.update(
        { id: chargeId, status: 'raised' },
        {
          status: input.decision,
          decidedBy: actorId,
          decidedAt: this.now(),
          rejectionReason: input.reason ?? null,
        },
      );
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
    input: { chargeType: ChargeType; amount: number; note?: string },
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

  /** "Adds who will receive the truck, often a day before." Any trip with a market truck. */
  async setUnloadingContact(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: { name: string; phone: string },
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertLoad(tenantId, loadId);
      if (load.status === 'closed') throw new ConflictError('This load is closed');
      const updated = await this.loadRepository.update(tenantId, loadId, {
        unloadingContactName: input.name,
        unloadingContactPhone: input.phone,
        updatedBy: actorId,
      });
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'LOADSMART_STEP',
        null,
        'unloading_contact_added',
        {
          ...input,
        },
      );
      return updated!;
    } catch (error) {
      rethrow(error, 'Failed to add the unloading contact');
    }
  }

  /** "The shipper adds the claim value" on a Loadsmart load delivered with issues. */
  async addClaimValue(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: { claimValue: number; note?: string },
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

  async getInvoice(tenantId: string, role: string, loadId: string) {
    await this.assertLoadsmartLoad(tenantId, loadId);
    const invoice = await this.repository.findInvoice(tenantId, loadId);
    if (!invoice) throw new NotFoundError("Loadsmart's invoice for this load isn't generated yet");
    const downloadUrl = invoice.fileKey
      ? (await this.storageService.getByKey({ tenantId, role }, invoice.fileKey)).downloadUrl
      : null;
    return { invoice, downloadUrl };
  }

  /** "The load memo, documents and payments stay on the load to download." */
  async documentsBundle(tenantId: string, role: string, loadId: string) {
    try {
      const load = await this.assertLoad(tenantId, loadId);
      const keyed: { type: string; label: string; key: string | null }[] = [
        { type: 'elr', label: 'e-LR', key: load.elrDocumentFileKey },
        { type: 'signed_lr', label: 'Signed LR', key: load.elrFileKey },
        { type: 'invoice', label: 'Goods invoice', key: load.invoiceFileKey },
        { type: 'eway_bill', label: 'E-way bill', key: load.ewayBillFileKey },
        { type: 'weighing_slip', label: 'Weighing slip', key: load.weighingSlipFileKey },
        { type: 'pod_front', label: 'POD front', key: load.podFileKey },
        { type: 'pod_back', label: 'POD back', key: load.podBackFileKey },
      ];
      const invoice = await this.repository.findInvoice(tenantId, loadId);
      if (invoice?.fileKey) {
        keyed.push({
          type: 'loadsmart_invoice',
          label: `Loadsmart invoice ${invoice.invoiceNumber}`,
          key: invoice.fileKey,
        });
      }
      const payments = await this.loadPaymentRepository.listByLoad(tenantId, loadId);

      const documents: BundleDocument[] = [];
      for (const doc of keyed) {
        if (!doc.key) continue;
        const { downloadUrl } = await this.storageService.getByKey({ tenantId, role }, doc.key);
        documents.push({ type: doc.type, label: doc.label, fileKey: doc.key, downloadUrl });
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
