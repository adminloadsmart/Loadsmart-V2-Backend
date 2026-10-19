import { AuthorizationError, ConflictError, NotFoundError, rethrow } from '../../../shared/errors';
import { ORG_ADMIN_ROLE } from '../../../shared/constants/roles';
import { AuditService } from '../../audit/audit.service';
import { paginate } from '../../../shared/utils/pagination';
import { IdfyClient, toBankVerificationColumns } from '../../../adapters/idfy.client';
import { panFromGstin } from '../../../shared/constants/gst-state-codes';
import { buildCsv, CSV_EXPORT_MAX_ROWS, CsvColumn } from '../../../shared/utils/csv';
import { CodeSequenceRepository } from '../../loads/code-sequence.repository';
import { formatTransporterCode } from '../../loads/utils/code.util';
import { GstVerificationService, gstNameMatches } from '../gst/gst.service';
import { MasterUsageRepository } from '../masters.usage';
import { TransporterEntity } from './entities/transporter.entity';
import {
  TransporterColumns,
  TransporterRepository,
  TransporterStats,
} from './transporter.repository';
import {
  CreateTransporterInput,
  ListTransportersInput,
  TransporterTruckTypeInput,
  UpdateTransporterInput,
} from './transporter.interface';
import { MasterRecordSource, TransporterCompanyType, TransporterStatus } from './transporter.types';

/** GST register "constitution of business" → the transporter company-type dropdown value. */
export function companyTypeFromConstitution(
  constitution: string | null | undefined,
): TransporterCompanyType | null {
  if (!constitution) return null;
  const value = constitution.toLowerCase();
  if (value.includes('propriet')) return 'proprietorship';
  if (value.includes('limited liability') || /\bllp\b/.test(value)) return 'llp';
  if (value.includes('partnership')) return 'partnership';
  if (value.includes('private limited')) return 'private_limited';
  if (value.includes('public limited')) return 'public_limited';
  if (value.includes('hindu undivided') || /\bhuf\b/.test(value)) return 'huf';
  return 'others';
}

function truckTypeColumns(
  truckType: TransporterTruckTypeInput | null | undefined,
): TransporterColumns {
  if (truckType === undefined) return {};
  return {
    truckBodyType: truckType?.bodyType ?? null,
    truckWheelCount: truckType?.wheelCount ?? null,
    truckCapacityTons: truckType?.capacityTons == null ? null : String(truckType.capacityTons),
    truckLengthFt: truckType?.lengthFt == null ? null : String(truckType.lengthFt),
  };
}

/**
 * A transporter as Settings → Transporters reads it: every entity column plus the list/drawer's
 * derived fields. `rating` stays null until a rating source exists (settings redesign plan).
 */
export function toTransporterView(transporter: TransporterEntity, stats?: TransporterStats) {
  const recordSource: MasterRecordSource =
    transporter.gstVerificationStatus === 'verified' ? 'shared_master' : 'own_record';
  return {
    ...transporter,
    recordSource,
    truckType: {
      bodyType: transporter.truckBodyType,
      wheelCount: transporter.truckWheelCount,
      capacityTons: transporter.truckCapacityTons,
      lengthFt: transporter.truckLengthFt,
    },
    rating: null as number | null,
    tripsDone: stats?.tripsDone ?? 0,
    freightOwed: stats?.freightOwed ?? '0.00',
  };
}

type TransporterView = ReturnType<typeof toTransporterView>;

const TRANSPORTER_EXPORT_COLUMNS: CsvColumn<TransporterView>[] = [
  { header: 'code', value: (t) => t.code },
  { header: 'name', value: (t) => t.name },
  { header: 'gstin', value: (t) => t.gstin },
  { header: 'pan', value: (t) => t.pan },
  { header: 'gstVerification', value: (t) => t.gstVerificationStatus },
  { header: 'companyType', value: (t) => t.companyType },
  { header: 'phone', value: (t) => t.phone },
  { header: 'email', value: (t) => t.email },
  { header: 'city', value: (t) => t.city },
  { header: 'state', value: (t) => t.state },
  { header: 'gstTreatment', value: (t) => t.gstTreatment },
  { header: 'trucksDeclared', value: (t) => t.trucksDeclared },
  { header: 'pocName', value: (t) => t.contacts?.[0]?.fullName },
  { header: 'pocPhone', value: (t) => t.contacts?.[0]?.phone },
  { header: 'pocEmail', value: (t) => t.contacts?.[0]?.email },
  { header: 'upiVpa', value: (t) => t.upiVpa },
  { header: 'bankAccountHolderName', value: (t) => t.bankAccountHolderName },
  { header: 'bankIfsc', value: (t) => t.bankIfsc },
  { header: 'bankAccountNumber', value: (t) => t.bankAccountNumber },
  { header: 'bankNameBranch', value: (t) => t.bankNameBranch },
  { header: 'tripsDone', value: (t) => t.tripsDone },
  { header: 'freightOwed', value: (t) => t.freightOwed },
  { header: 'status', value: (t) => t.status },
];

export class TransporterService {
  constructor(
    private readonly repository: TransporterRepository,
    private readonly audit: AuditService,
    private readonly codeSequences: CodeSequenceRepository,
    private readonly gstVerification: GstVerificationService,
    private readonly usage: MasterUsageRepository,
    private readonly idfyClient: IdfyClient,
  ) {}
  private assertAdmin(role: string) {
    if (role !== ORG_ADMIN_ROLE)
      throw new AuthorizationError('Only organization admins can manage transporters');
  }

  /** GST bookkeeping: verified only when backed by a verified lookup row. A verified lookup also
   *  fills PAN/constitution/company type and, where the form left them blank, the base address. */
  private async gstColumns(
    tenantId: string,
    gstin: string | null | undefined,
    verificationId: string | null | undefined,
    name: string,
    current: Pick<
      Partial<TransporterEntity>,
      'companyType' | 'addressLine1' | 'addressLine2' | 'city' | 'state' | 'pinCode'
    >,
  ): Promise<TransporterColumns> {
    const base: TransporterColumns = {
      pan: panFromGstin(gstin),
      gstStateCode: gstin ? gstin.slice(0, 2) : null,
    };
    const verified = await this.gstVerification.resolveVerified(tenantId, gstin, verificationId);
    if (!verified) {
      return {
        ...base,
        gstVerificationStatus: 'unverified',
        gstVerificationId: null,
        gstVerifiedAt: null,
        gstRegistryName: null,
        gstNameMatched: null,
      };
    }
    const address = verified.addressParts;
    return {
      ...base,
      gstVerificationStatus: 'verified',
      gstVerificationId: verified.id,
      gstVerifiedAt: verified.createdAt,
      gstRegistryName: verified.legalName,
      gstNameMatched: gstNameMatches(name, verified),
      constitution: verified.constitution,
      companyType: current.companyType ?? companyTypeFromConstitution(verified.constitution),
      addressLine1: current.addressLine1 || address?.addressLine1 || null,
      addressLine2: current.addressLine2 || address?.addressLine2 || null,
      city: current.city || address?.city || null,
      state: current.state || address?.state || null,
      pinCode: current.pinCode || address?.pinCode || null,
    };
  }

  /** "Penny Drop Verified" — IDfy penny-less/penny-drop check, same as driver bank details. */
  private async bankColumns(accountNumber: string, ifsc: string): Promise<TransporterColumns> {
    const columns = toBankVerificationColumns(
      await this.idfyClient.verifyBankAccount(accountNumber, ifsc.toUpperCase()),
    );
    return {
      bankVerificationStatus: columns.verificationStatus,
      bankVerifiedAt: columns.verifiedAt,
      bankVerificationReference: columns.sourceReference,
      bankNameAtBank: columns.nameAtBank,
      bankRawResponse: columns.rawResponse,
    };
  }

  async create(
    tenantId: string,
    actorId: string,
    role: string,
    input: CreateTransporterInput,
    options: { verifyBank?: boolean } = {},
  ) {
    try {
      this.assertAdmin(role);
      const name = input.name.trim();
      if (await this.repository.findByPhone(tenantId, input.phone))
        throw new ConflictError(`A transporter with phone "${input.phone}" already exists`);
      const extra: TransporterColumns = {
        ...(input.gstin
          ? await this.gstColumns(tenantId, input.gstin, input.gstVerificationId, name, input)
          : {}),
        ...truckTypeColumns(input.truckType),
        ...(options.verifyBank !== false && input.bankAccountNumber && input.bankIfsc
          ? await this.bankColumns(input.bankAccountNumber, input.bankIfsc)
          : {}),
      };
      const transporter = await this.repository.transaction(async (manager) => {
        const code = formatTransporterCode(
          await this.codeSequences.next('transporter', tenantId, manager),
        );
        const value = await this.repository.create(
          { ...input, name, tenantId, createdBy: actorId },
          { ...extra, code },
          manager,
        );
        if (input.contacts?.length)
          await this.repository.syncContacts(tenantId, value.id, input.contacts, manager);
        if (input.lanes?.length)
          await this.repository.syncLanes(tenantId, value.id, input.lanes, manager);
        return this.repository.findById(tenantId, value.id, manager);
      });
      if (!transporter) throw new NotFoundError('Transporter was not created');
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'TRANSPORTER_CREATED',
        resourceType: 'transporter',
        newData: this.snapshot(transporter),
      });
      return toTransporterView(transporter);
    } catch (error) {
      rethrow(error, 'Failed to create transporter');
    }
  }
  async list(tenantId: string, role: string, input: ListTransportersInput) {
    try {
      this.assertAdmin(role);
      const result = await this.repository.list(tenantId, input);
      return paginate(
        result.items.map((item) => toTransporterView(item.transporter, item.stats)),
        result.total,
        input,
      );
    } catch (error) {
      rethrow(error, 'Failed to list transporters');
    }
  }
  async export(
    tenantId: string,
    role: string,
    filters: Omit<ListTransportersInput, 'page' | 'limit'>,
  ): Promise<string> {
    try {
      this.assertAdmin(role);
      const result = await this.repository.listForExport(tenantId, filters, CSV_EXPORT_MAX_ROWS);
      return buildCsv(
        TRANSPORTER_EXPORT_COLUMNS,
        result.items.map((item) => toTransporterView(item.transporter, item.stats)),
      );
    } catch (error) {
      rethrow(error, 'Failed to export transporters');
    }
  }
  async get(tenantId: string, role: string, id: string) {
    try {
      this.assertAdmin(role);
      const transporter = await this.repository.findById(tenantId, id);
      if (!transporter) throw new NotFoundError(`Transporter ${id} not found`);
      return toTransporterView(transporter, await this.repository.statsFor(tenantId, id));
    } catch (error) {
      rethrow(error, 'Failed to fetch transporter');
    }
  }

  async getTransporter(tenantId: string, id: string) {
    try {
      const transporter = await this.repository.findById(tenantId, id);
      if (!transporter) throw new NotFoundError(`Transporter ${id} not found`);
      return transporter;
    } catch (error) {
      rethrow(error, 'Failed to fetch transporter');
    }
  }

  /** Transporter detail drawer "LOADS MOVED", newest first. */
  async listLoads(
    tenantId: string,
    role: string,
    id: string,
    pagination: { page: number; limit: number },
  ) {
    try {
      this.assertAdmin(role);
      if (!(await this.repository.findById(tenantId, id)))
        throw new NotFoundError(`Transporter ${id} not found`);
      const result = await this.usage.loadHistory(
        tenantId,
        { kind: 'transporter', id },
        pagination.page,
        pagination.limit,
      );
      return paginate(result.items, result.total, pagination);
    } catch (error) {
      rethrow(error, 'Failed to list transporter loads');
    }
  }

  /** Running loads (block inactivate/delete) plus live contracts (warned about, not blocking). */
  async usageOf(tenantId: string, role: string, id: string) {
    try {
      this.assertAdmin(role);
      if (!(await this.repository.findById(tenantId, id)))
        throw new NotFoundError(`Transporter ${id} not found`);
      const [activeLoads, liveContracts] = await Promise.all([
        this.usage.activeLoads(tenantId, { kind: 'transporter', id }),
        this.repository.countLiveContracts(tenantId, id),
      ]);
      return { inUse: activeLoads.length > 0, activeLoads, liveContracts };
    } catch (error) {
      rethrow(error, 'Failed to check transporter usage');
    }
  }

  private async assertNotInUse(tenantId: string, id: string, action: string) {
    const activeLoads = await this.usage.activeLoads(tenantId, { kind: 'transporter', id });
    if (activeLoads.length)
      throw new ConflictError(
        `Transporter is in use right now — ${activeLoads[0].code} is still running, so it cannot be ${action}`,
        { activeLoads },
      );
  }

  async update(
    tenantId: string,
    actorId: string,
    role: string,
    id: string,
    input: UpdateTransporterInput,
  ) {
    try {
      this.assertAdmin(role);
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Transporter ${id} not found`);
      const name = input.name?.trim();
      if (
        input.phone &&
        input.phone !== existing.phone &&
        (await this.repository.findByPhone(tenantId, input.phone))
      )
        throw new ConflictError(`A transporter with phone "${input.phone}" already exists`);
      if (input.status === 'inactive' && existing.status !== 'inactive')
        await this.assertNotInUse(tenantId, id, 'made inactive');

      const { contacts, lanes, truckType, gstVerificationId, advancePercentage, ...columns } =
        input;
      const extra: TransporterColumns = { ...truckTypeColumns(truckType) };
      const gstin = input.gstin === undefined ? existing.gstin : input.gstin;
      const gstinChanged = input.gstin !== undefined && input.gstin !== existing.gstin;
      if (gstVerificationId || gstinChanged) {
        Object.assign(
          extra,
          await this.gstColumns(tenantId, gstin, gstVerificationId, name ?? existing.name, {
            companyType:
              columns.companyType === undefined ? existing.companyType : columns.companyType,
            addressLine1:
              columns.addressLine1 === undefined ? existing.addressLine1 : columns.addressLine1,
            addressLine2:
              columns.addressLine2 === undefined ? existing.addressLine2 : columns.addressLine2,
            city: columns.city === undefined ? existing.city : columns.city,
            state: columns.state === undefined ? existing.state : columns.state,
            pinCode: columns.pinCode === undefined ? existing.pinCode : columns.pinCode,
          }),
        );
      }
      const accountNumber =
        input.bankAccountNumber === undefined
          ? existing.bankAccountNumber
          : input.bankAccountNumber;
      const ifsc = input.bankIfsc === undefined ? existing.bankIfsc : input.bankIfsc;
      const bankChanged =
        accountNumber !== existing.bankAccountNumber || ifsc !== existing.bankIfsc;
      if (bankChanged) {
        Object.assign(
          extra,
          accountNumber && ifsc
            ? await this.bankColumns(accountNumber, ifsc)
            : {
                bankVerificationStatus: null,
                bankVerifiedAt: null,
                bankVerificationReference: null,
                bankNameAtBank: null,
                bankRawResponse: null,
              },
        );
      }

      const updated = await this.repository.transaction(async (manager) => {
        const value = await this.repository.update(
          tenantId,
          id,
          {
            ...columns,
            ...(name ? { name } : {}),
            advancePercentage:
              advancePercentage === undefined || advancePercentage === null
                ? advancePercentage
                : advancePercentage.toString(),
            ...extra,
            updatedBy: actorId,
          },
          manager,
        );
        if (!value) throw new NotFoundError(`Transporter ${id} not found`);
        if (contacts !== undefined)
          await this.repository.syncContacts(tenantId, id, contacts, manager);
        if (lanes !== undefined) await this.repository.syncLanes(tenantId, id, lanes, manager);
        return this.repository.findById(tenantId, id, manager);
      });
      if (!updated) throw new NotFoundError(`Transporter ${id} not found`);
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'TRANSPORTER_UPDATED',
        resourceType: 'transporter',
        oldData: this.snapshot(existing),
        newData: this.snapshot(updated),
      });
      return toTransporterView(updated, await this.repository.statsFor(tenantId, id));
    } catch (error) {
      rethrow(error, 'Failed to update transporter');
    }
  }

  async updateStatus(
    tenantId: string,
    actorId: string,
    role: string,
    id: string,
    status: TransporterStatus,
  ) {
    try {
      this.assertAdmin(role);
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Transporter ${id} not found`);
      if (existing.status === status) throw new ConflictError(`Transporter is already ${status}`);
      if (status === 'inactive') await this.assertNotInUse(tenantId, id, 'made inactive');
      const updated = await this.repository.update(tenantId, id, { status, updatedBy: actorId });
      if (!updated) throw new NotFoundError(`Transporter ${id} not found`);
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'TRANSPORTER_STATUS_UPDATED',
        resourceType: 'transporter',
        oldData: { id, status: existing.status },
        newData: { id, status },
      });
      return toTransporterView(updated, await this.repository.statsFor(tenantId, id));
    } catch (error) {
      rethrow(error, 'Failed to update transporter status');
    }
  }

  async delete(tenantId: string, actorId: string, role: string, id: string) {
    try {
      this.assertAdmin(role);
      const existing = await this.repository.findById(tenantId, id);
      if (!existing) throw new NotFoundError(`Transporter ${id} not found`);
      await this.assertNotInUse(tenantId, id, 'deleted');
      await this.repository.softDelete(tenantId, id, actorId);
      await this.audit.log({
        tenantId,
        userId: actorId,
        action: 'TRANSPORTER_DELETED',
        resourceType: 'transporter',
        oldData: this.snapshot(existing),
      });
    } catch (error) {
      rethrow(error, 'Failed to delete transporter');
    }
  }
  private snapshot(value: TransporterEntity) {
    return {
      id: value.id,
      tenantId: value.tenantId,
      code: value.code,
      name: value.name,
      phone: value.phone,
      rate: value.rate,
      email: value.email,
      gstin: value.gstin,
      gstVerificationStatus: value.gstVerificationStatus,
      msmeRegistration: value.msmeRegistration,
      companyType: value.companyType,
      status: value.status,
      advancePercentage: value.advancePercentage,
      creditDays: value.creditDays,
      addressLine1: value.addressLine1,
      addressLine2: value.addressLine2,
      landmark: value.landmark,
      areaLocality: value.areaLocality,
      city: value.city,
      state: value.state,
      pinCode: value.pinCode,
      gstTreatment: value.gstTreatment,
      trucksDeclared: value.trucksDeclared,
      upiVpa: value.upiVpa,
      bankAccountNumber: value.bankAccountNumber,
      bankIfsc: value.bankIfsc,
      bankAccountHolderName: value.bankAccountHolderName,
      bankVerificationStatus: value.bankVerificationStatus,
      contactCount: value.contacts?.length ?? 0,
      laneCount: value.lanes?.length ?? 0,
      deletedAt: value.deletedAt,
    };
  }
}
