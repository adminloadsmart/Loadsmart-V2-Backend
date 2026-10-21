import { DataSource, IsNull } from 'typeorm';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors';
import { GSTIN_REGEX } from '../../../shared/constants/gst-state-codes';
import { ImportReport } from '../../../shared/import/report';
import { importRows } from '../../../shared/import/run';
import { buildImportSample } from '../../../shared/import/sample';
import { ImportFileType, parseImportSheet, ParsedImportSheet } from '../../../shared/import/parse';
import { IMPORT_MAX_ROWS, ImportSource } from '../../../shared/import/upload';
import { AuditService } from '../../audit/audit.service';
import { TransporterEntity } from '../transporter/entities/transporter.entity';
import { ContractService } from './contract.service';
import { contractImportRowSchema } from './contract.validators';
import { CreateContractInput } from './contract.interface';
import {
  IMPORT_COLUMNS,
  TEMPLATE_COLUMNS,
  TRANSPORTER_LIST,
  transporterOptionLabel,
} from './contract-import.columns';

export const CONTRACT_IMPORT_SAMPLE_FILENAME = 'contract-bulk-upload-template.xlsx';

/** Transporters listed in the template's dropdown — beyond this, type the code instead. */
const TEMPLATE_TRANSPORTER_LIMIT = 2000;

type ContractImportRow = z.infer<typeof contractImportRowSchema>;
type TransporterRef = Pick<TransporterEntity, 'id' | 'code' | 'name'>;

export function parseContractSheet(
  buffer: Buffer,
  fileType: ImportFileType = 'xlsx',
): Promise<ParsedImportSheet<ContractImportRow>> {
  return parseImportSheet<ContractImportRow>(buffer, fileType, IMPORT_COLUMNS, {
    maxRows: IMPORT_MAX_ROWS,
    requiredColumns: [
      ['transporter', 'transporterCode', 'transporterGstin', 'transporterName'],
      ['sourceCity'],
      ['destinationCity'],
      ['agreedRate'],
      ['validFrom'],
      ['validTo'],
    ],
  });
}

/** A validated sheet row → the POST /masters/contracts payload, with the resolved transporter. */
function toContractInput(row: ContractImportRow, transporterId: string): CreateContractInput {
  return {
    transporterId,
    sourceCity: row.sourceCity,
    sourceState: row.sourceState,
    destinationCity: row.destinationCity,
    destinationState: row.destinationState,
    agreedRate: row.agreedRate,
    billingUnit: row.billingUnit,
    validFrom: row.validFrom,
    validTo: row.validTo,
    priority: row.priority,
    sharePercentage: row.sharePercentage,
    notes: row.notes,
  };
}

/** Settings → Contracts "Bulk Upload". Each row goes through ContractService.create, so the same
 *  lane rules (one per transporter, unique priority, ≤100% share) apply row by row. */
export class ContractImportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly contracts: ContractService,
    private readonly audit: AuditService,
  ) {}

  /** The template with this tenant's active transporters as the Transporter dropdown. */
  async sample(tenantId: string): Promise<Buffer> {
    const transporters = await this.dataSource.getRepository(TransporterEntity).find({
      select: { id: true, code: true, name: true },
      where: { tenantId, status: 'active', deletedAt: IsNull() },
      order: { code: 'ASC' },
      take: TEMPLATE_TRANSPORTER_LIMIT,
    });
    const options = transporters.map(transporterOptionLabel);
    return buildImportSample({
      sheetName: 'Contracts',
      columns: TEMPLATE_COLUMNS,
      lists: { [TRANSPORTER_LIST]: options },
      examples: options.length ? { transporter: options[0] } : {},
      notes: [
        options.length
          ? 'Transporter: pick from the dropdown (your active transporters), or type a transporter code, GSTIN or exact name.'
          : 'You have no active transporters yet — add them first (Transporters tab), then type their code, GSTIN or name in the Transporter column.',
        'A transporter can hold one contract per lane; priorities on a lane must be unique and shares add up to 100% at most. Rows breaking these are reported and skipped.',
      ],
    });
  }

  async import(
    tenantId: string,
    actorId: string,
    role: string,
    source: ImportSource,
  ): Promise<ImportReport> {
    const parsed = await this.parse(source);
    const resolve = this.transporterResolver(tenantId);
    const report = await importRows(parsed, {
      columns: IMPORT_COLUMNS,
      schema: contractImportRowSchema,
      check: async (row) =>
        (await resolve(row)) ? null : { field: 'Transporter', message: 'Transporter not found' },
      create: async (row) =>
        this.contracts.create(
          tenantId,
          actorId,
          role,
          toContractInput(row, (await resolve(row))!.id),
        ),
    });
    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'TRANSPORTER_CONTRACT_BULK_IMPORTED',
      resourceType: 'transporter_contract',
      newData: {
        fileName: source.fileName,
        totalRows: report.total,
        created: report.created,
        failed: report.failed,
      },
    });
    return report;
  }

  /** Row → transporter, cached per import. The Transporter cell may be the dropdown value
   *  ("TRP-1049 · ABC Logistics"), a code, a GSTIN or the exact name (any case). */
  private transporterResolver(tenantId: string) {
    const cache = new Map<string, Promise<TransporterRef | null>>();
    const repo = this.dataSource.getRepository(TransporterEntity);
    const base = { tenantId, deletedAt: IsNull() };
    const select = { id: true, code: true, name: true } as const;

    const lookup = (ref: string): Promise<TransporterRef | null> => {
      const value = ref.trim();
      const code = value.split('·')[0].trim().toUpperCase();
      if (/^[A-Z]{2,5}-\d+$/.test(code)) return repo.findOne({ select, where: { ...base, code } });
      if (GSTIN_REGEX.test(value.toUpperCase()))
        return repo.findOne({ select, where: { ...base, gstin: value.toUpperCase() } });
      return repo
        .createQueryBuilder('transporter')
        .select(['transporter.id', 'transporter.code', 'transporter.name'])
        .where('transporter.tenant_id = :tenantId', { tenantId })
        .andWhere('transporter.deleted_at IS NULL')
        .andWhere('LOWER(TRIM(transporter.name)) = LOWER(:name)', { name: value })
        .getOne();
    };

    return (row: ContractImportRow) => {
      const ref =
        row.transporter ?? row.transporterCode ?? row.transporterGstin ?? row.transporterName!;
      let found = cache.get(ref);
      if (!found) {
        found = lookup(ref);
        cache.set(ref, found);
      }
      return found;
    };
  }

  private async parse(source: ImportSource): Promise<ParsedImportSheet<ContractImportRow>> {
    try {
      return await parseContractSheet(source.buffer, source.fileType);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Invalid file');
    }
  }
}
