import { DataSource, Repository } from 'typeorm';
import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../../shared/errors';
import { AuditService } from '../../audit/audit.service';
import { StorageService } from '../../storage/storage.service';
import { LoadActivityService } from '../activity/load-activity.service';
import { LoadRepository } from '../core/load.repository';
import { LoadDocumentService } from '../documents/load-document.service';
import { assertConfirmedUpload } from '../documents/upload-check';
import { LoadEntity } from '../entities/load.entity';
import { TransporterChargeHead } from './charge.types';
import { LoadChargeEntity } from './load-charge.entity';
import { CHARGE_STAGES } from './money-rules';

export interface AddTransporterChargeInput {
  head: TransporterChargeHead;
  amount: number;
  /** Required with the `other` head. */
  remark?: string;
  /** A photo or document — uploaded for purpose loads/charge-proof. */
  proofFileKey: string;
}

/**
 * Charges on an own-transporter or indent load: "the shipper adds charges with proof — a photo or
 * document with each charge". The shipper pays them to the transporter with the balance, so a
 * charge counts as entered (approved). Loadsmart loads raise and approve their charges in the
 * Loadsmart ops module.
 */
export class LoadChargeService {
  private readonly charges: Repository<LoadChargeEntity>;

  constructor(
    dataSource: DataSource,
    private readonly loadRepository: LoadRepository,
    private readonly storageService: StorageService,
    private readonly documents: LoadDocumentService,
    private readonly loadActivityService: LoadActivityService,
    private readonly auditService: AuditService,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.charges = dataSource.getRepository(LoadChargeEntity);
  }

  listForLoad(tenantId: string, loadId: string): Promise<LoadChargeEntity[]> {
    return this.charges.find({ where: { tenantId, loadId }, order: { createdAt: 'ASC' } });
  }

  async add(
    tenantId: string,
    actorId: string,
    actorRole: string,
    loadId: string,
    input: AddTransporterChargeInput,
  ): Promise<LoadChargeEntity> {
    try {
      const load = await this.assertTransporterLoad(tenantId, loadId);
      if (!CHARGE_STAGES.includes(load.status)) {
        throw new ConflictError('Charges are added from Loaded until the balance is paid');
      }
      const remark = input.remark?.trim() || null;
      if (input.head === 'other' && !remark) {
        throw new ValidationError('Add a remark for a charge under "other"');
      }
      await assertConfirmedUpload(
        this.storageService,
        tenantId,
        actorRole,
        input.proofFileKey,
        'loads/charge-proof',
      );

      const now = this.now();
      const charge = await this.charges.save(
        this.charges.create({
          tenantId,
          loadId,
          chargeType: input.head,
          amount: String(input.amount),
          note: remark,
          proofFileKey: input.proofFileKey,
          status: 'approved',
          raisedByParty: 'shipper',
          raisedBy: actorId,
          decidedBy: actorId,
          decidedAt: now,
        }),
      );
      await this.documents.save(
        tenantId,
        load,
        { updatedBy: actorId },
        { userId: actorId, source: 'web' },
        [{ docType: 'charge_proof', fileKey: input.proofFileKey }],
      );
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'CHARGE_ADDED',
        null,
        input.head,
        { chargeId: charge.id, amount: charge.amount, remark },
      );
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LOAD_CHARGE_ADDED',
        resourceType: 'load_charge',
        newData: { id: charge.id, loadId, head: input.head, amount: charge.amount, remark },
      });
      return charge;
    } catch (error) {
      rethrow(error, 'Failed to add the charge');
    }
  }

  private async assertTransporterLoad(tenantId: string, loadId: string): Promise<LoadEntity> {
    const load = await this.loadRepository.findById(tenantId, loadId);
    if (!load) throw new NotFoundError(`Load ${loadId} not found`);
    if (load.route !== 'own_transporter' && load.route !== 'indent') {
      throw new ConflictError(
        load.route === 'loadsmart'
          ? "On a Loadsmart load, Loadsmart's team raises the charges"
          : 'Charges are added on loads carried by your own transporter or on an indent',
      );
    }
    return load;
  }
}
