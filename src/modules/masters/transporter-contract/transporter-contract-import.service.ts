import { ValidationError } from '../../../shared/errors';
import { AuditService } from '../../audit/audit.service';
import { TransporterRepository } from '../transporter/transporter.repository';
import { CreateTransporterContractInput } from './transporter-contract.interface';
import { TransporterContractRepository } from './transporter-contract.repository';
import { TransporterContractService } from './transporter-contract.service';
import { transporterContractValidators } from './transporter-contract.validators';
import {
  ParsedContractExcel,
  parseTransporterContractExcel,
} from './transporter-contract-import.mapper';

export interface TransporterContractImportRowError {
  row: number;
  field?: string;
  message: string;
}

export interface TransporterContractImportReport {
  totalRows: number;
  validRows: number;
  created: number;
  skipped: number;
  failed: number;
  columnMapping: Record<string, string>;
  errors: TransporterContractImportRowError[];
}

export class TransporterContractImportService {
  constructor(
    private readonly contracts: TransporterContractService,
    private readonly contractRepository: TransporterContractRepository,
    private readonly transporterRepository: TransporterRepository,
    private readonly audit: AuditService,
  ) {}

  async import(
    tenantId: string,
    actorId: string,
    fileName: string,
    buffer: Buffer,
  ): Promise<TransporterContractImportReport> {
    const parsed = await this.parse(buffer);
    const errors: TransporterContractImportRowError[] = [];
    const valid: { row: number; input: CreateTransporterContractInput }[] = [];
    const customerIds = new Map<string, string | null>();
    const transporterIds = new Map<string, string | null>();

    for (const item of parsed.rows) {
      const { customerCode, transporterPhone, ...fields } = item.input;

      if (!customerIds.has(customerCode ?? '')) {
        const customer = customerCode
          ? await this.contractRepository.findCustomerByCode(tenantId, customerCode)
          : null;
        customerIds.set(customerCode ?? '', customer?.id ?? null);
      }
      if (!transporterIds.has(transporterPhone ?? '')) {
        const phone = (transporterPhone ?? '').replace(/[\s-]/g, '');
        const transporter = phone
          ? await this.transporterRepository.findByPhone(tenantId, phone)
          : null;
        transporterIds.set(transporterPhone ?? '', transporter?.id ?? null);
      }
      const customerId = customerIds.get(customerCode ?? '');
      const transporterId = transporterIds.get(transporterPhone ?? '');
      if (!customerId) {
        errors.push({
          row: item.row,
          field: 'customerCode',
          message: `Customer "${customerCode ?? ''}" not found`,
        });
      }
      if (!transporterId) {
        errors.push({
          row: item.row,
          field: 'transporterPhone',
          message: `Transporter with phone "${transporterPhone ?? ''}" not found`,
        });
      }
      if (!customerId || !transporterId) continue;

      const result = transporterContractValidators.createContract.safeParse({
        body: { ...fields, customerId, transporterId },
      });
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({ row: item.row, field: issue.path[1]?.toString(), message: issue.message });
        }
        continue;
      }
      valid.push({ row: item.row, input: result.data.body as CreateTransporterContractInput });
    }

    const report: TransporterContractImportReport = {
      totalRows: parsed.rows.length,
      validRows: valid.length,
      created: 0,
      skipped: 0,
      failed: errors.length,
      columnMapping: parsed.mapping,
      errors,
    };

    // Row by row, in file order, so each row's priority/share check sees the rows before it.
    for (const item of valid) {
      try {
        await this.contracts.create(tenantId, actorId, item.input);
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
      newData: { fileName, ...report },
    });
    return report;
  }

  private async parse(buffer: Buffer): Promise<ParsedContractExcel> {
    try {
      return await parseTransporterContractExcel(buffer);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Invalid Excel file');
    }
  }
}
