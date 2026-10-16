import { DataSource, IsNull } from 'typeorm';
import { ValidationError } from '../../../shared/errors';
import { parseSpreadsheetRows } from '../../../shared/utils/spreadsheet';
import { AuditService } from '../../audit/audit.service';
import { TransporterEntity } from '../transporter/entities/transporter.entity';
import { ContractService } from './contract.service';
import { contractImportRowSchema } from './contract.validators';
import { CreateContractInput } from './contract.interface';

export const CONTRACT_IMPORT_MAX_ROWS = 5000;

/** Normalised header → import field. Matches the export's headers. */
const FIELD_BY_HEADER: Record<string, string> = {
  transportercode: 'transporterCode',
  code: 'transporterCode',
  transportergstin: 'transporterGstin',
  gstin: 'transporterGstin',
  transportername: 'transporterName',
  transporter: 'transporterName',
  sourcecity: 'sourceCity',
  sourcestate: 'sourceState',
  destinationcity: 'destinationCity',
  destinationstate: 'destinationState',
  agreedrate: 'agreedRate',
  rate: 'agreedRate',
  billingunit: 'billingUnit',
  validfrom: 'validFrom',
  validto: 'validTo',
  expirydate: 'validTo',
  priority: 'priority',
  ranking: 'priority',
  sharepercentage: 'sharePercentage',
  share: 'sharePercentage',
  notes: 'notes',
};
const IGNORED_HEADERS = new Set(['status', 'daystoexpiry']);
const NUMERIC_FIELDS = new Set(['agreedRate', 'sharePercentage']);

const normalize = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();

/** "P1" / "1" → 1; "Per ton" / "per_truck" → enum value. */
function coerce(field: string, raw: string): unknown {
  if (NUMERIC_FIELDS.has(field)) {
    const parsed = Number(raw.replace(/%|₹|,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  if (field === 'priority') return Number(raw.replace(/^p/i, '').trim());
  if (field === 'billingUnit') return normalize(raw).includes('truck') ? 'per_truck' : 'per_ton';
  return raw;
}

export interface ContractImportReport {
  totalRows: number;
  validRows: number;
  created: number;
  failed: number;
  columnMapping: Record<string, string>;
  errors: { row: number; field?: string; message: string }[];
}

/** Settings → Contracts "Bulk Upload" (.xlsx). Each row goes through ContractService.create, so
 *  the same lane rules (one per transporter, unique priority, ≤100% share) apply row by row. */
export class ContractImportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly contracts: ContractService,
    private readonly audit: AuditService,
  ) {}

  async import(
    tenantId: string,
    actorId: string,
    role: string,
    fileName: string,
    buffer: Buffer,
  ): Promise<ContractImportReport> {
    const { rows, mapping } = await this.parse(buffer);
    const report: ContractImportReport = {
      totalRows: rows.length,
      validRows: 0,
      created: 0,
      failed: 0,
      columnMapping: mapping,
      errors: [],
    };
    for (const item of rows) {
      const parsed = contractImportRowSchema.safeParse(item.input);
      if (!parsed.success) {
        report.failed += 1;
        for (const issue of parsed.error.issues)
          report.errors.push({
            row: item.row,
            field: issue.path[0]?.toString(),
            message: issue.message,
          });
        continue;
      }
      const { transporterCode, transporterGstin, transporterName, ...rest } = parsed.data;
      const transporter = await this.findTransporter(tenantId, {
        transporterCode,
        transporterGstin,
        transporterName,
      });
      if (!transporter) {
        report.failed += 1;
        report.errors.push({
          row: item.row,
          field: 'transporterCode',
          message: 'Transporter not found',
        });
        continue;
      }
      report.validRows += 1;
      try {
        await this.contracts.create(tenantId, actorId, role, {
          ...rest,
          transporterId: transporter.id,
        } as CreateContractInput);
        report.created += 1;
      } catch (error) {
        report.failed += 1;
        report.errors.push({
          row: item.row,
          message: error instanceof Error ? error.message : 'Failed to create contract',
        });
      }
    }
    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'TRANSPORTER_CONTRACT_BULK_IMPORTED',
      resourceType: 'transporter_contract',
      newData: {
        fileName,
        totalRows: report.totalRows,
        created: report.created,
        failed: report.failed,
      },
    });
    return report;
  }

  private findTransporter(
    tenantId: string,
    ref: { transporterCode?: string; transporterGstin?: string; transporterName?: string },
  ) {
    const repo = this.dataSource.getRepository(TransporterEntity);
    const base = { tenantId, deletedAt: IsNull() };
    if (ref.transporterCode) return repo.findOneBy({ ...base, code: ref.transporterCode });
    if (ref.transporterGstin)
      return repo.findOneBy({ ...base, gstin: ref.transporterGstin.toUpperCase() });
    return repo.findOneBy({ ...base, name: ref.transporterName });
  }

  private async parse(buffer: Buffer) {
    try {
      const records = await parseSpreadsheetRows(buffer);
      if (!records.length)
        throw new Error('Excel file must contain a header and at least one data row');
      if (records.length > CONTRACT_IMPORT_MAX_ROWS)
        throw new Error(`Excel file cannot contain more than ${CONTRACT_IMPORT_MAX_ROWS} rows`);
      const mapping: Record<string, string> = {};
      for (const header of Object.keys(records[0])) {
        const key = normalize(header);
        if (IGNORED_HEADERS.has(key)) continue;
        const field = FIELD_BY_HEADER[key];
        if (!field) throw new Error(`Unexpected column "${header}"`);
        if (Object.values(mapping).includes(field))
          throw new Error(`Multiple columns map to "${field}"`);
        mapping[header] = field;
      }
      const rows = records.map((record, index) => {
        const input: Record<string, unknown> = {};
        for (const [header, field] of Object.entries(mapping)) {
          const raw = record[header]?.trim();
          if (raw) input[field] = coerce(field, raw);
        }
        return { row: index + 2, input };
      });
      return { rows, mapping };
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Invalid Excel file');
    }
  }
}
