import { DataSource } from 'typeorm';
import { customerValidators } from './customer.validators';
import { CustomerService } from './customer.service';
import { parseCustomerExcel, ParsedCustomerExcel } from './customer-import.mapper';
import { CreateCustomerInput } from './customer.types';
import { CustomerEntity } from './entities/customer.entity';
import { ValidationError } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';

export interface ImportRowError {
  row: number;
  field?: string;
  message: string;
}
export interface ImportReport {
  totalRows: number;
  validRows: number;
  created: number;
  skipped: number;
  failed: number;
  columnMapping: Record<string, string>;
  errors: ImportRowError[];
}

export class CustomerImportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly customers: CustomerService,
    private readonly audit: AuditService,
  ) {}

  private async inspect(
    parsed: ParsedCustomerExcel,
    tenantId: string,
  ): Promise<{
    valid: { row: number; input: CreateCustomerInput }[];
    errors: ImportRowError[];
    skipped: number;
  }> {
    const errors: ImportRowError[] = [];
    const valid: { row: number; input: CreateCustomerInput }[] = [];
    const mobiles = new Set<string>();
    let skipped = 0;
    for (const item of parsed.rows) {
      const result = customerValidators.create.safeParse({ body: item.input });
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({
            row: item.row,
            field: issue.path[1]?.toString() ?? issue.path[0]?.toString(),
            message: issue.message,
          });
        }
        continue;
      }
      const input = result.data.body as CreateCustomerInput;
      const mobile = input.mobile.replace(/[\s-]/g, '');
      if (mobiles.has(mobile)) {
        errors.push({
          row: item.row,
          field: 'mobile',
          message: 'Duplicate mobile number in this file',
        });
        continue;
      }
      mobiles.add(mobile);
      const existing = await this.findExisting(tenantId, input);
      if (existing) {
        skipped += 1;
        continue;
      }
      valid.push({ row: item.row, input });
    }
    return { valid, errors, skipped };
  }

  private findExisting(tenantId: string, input: CreateCustomerInput) {
    const query = this.dataSource
      .getRepository(CustomerEntity)
      .createQueryBuilder('customer')
      .where('customer.tenant_id = :tenantId', { tenantId })
      .andWhere('customer.deleted_at IS NULL');

    if (input.gstin) {
      query.andWhere('(customer.mobile = :mobile OR customer.gstin = :gstin)', {
        mobile: input.mobile,
        gstin: input.gstin,
      });
    } else {
      query.andWhere('customer.mobile = :mobile', { mobile: input.mobile });
    }

    return query.getOne();
  }

  async preview(tenantId: string, buffer: Buffer): Promise<ImportReport> {
    const parsed = await this.parse(buffer);
    const inspected = await this.inspect(parsed, tenantId);
    const report: ImportReport = {
      totalRows: parsed.rows.length,
      validRows: inspected.valid.length,
      created: 0,
      skipped: inspected.skipped,
      failed: inspected.errors.length,
      columnMapping: parsed.mapping,
      errors: inspected.errors,
    };
    return report;
  }

  async import(
    tenantId: string,
    actorId: string,
    role: string,
    fileName: string,
    buffer: Buffer,
  ): Promise<ImportReport> {
    const parsed = await this.parse(buffer);
    const inspected = await this.inspect(parsed, tenantId);
    const report: ImportReport = {
      totalRows: parsed.rows.length,
      validRows: inspected.valid.length,
      created: 0,
      skipped: inspected.skipped,
      failed: inspected.errors.length,
      columnMapping: parsed.mapping,
      errors: [...inspected.errors],
    };
    for (const item of inspected.valid) {
      try {
        await this.customers.create(tenantId, actorId, role, item.input, 'csv_import');
        report.created += 1;
      } catch (error) {
        report.failed += 1;
        report.errors.push({
          row: item.row,
          message: error instanceof Error ? error.message : 'Failed to create customer',
        });
      }
    }
    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'CUSTOMER_BULK_IMPORTED',
      resourceType: 'customer',
      newData: {
        fileName,
        totalRows: report.totalRows,
        created: report.created,
        skipped: report.skipped,
        failed: report.failed,
      },
    });
    return report;
  }

  private async parse(buffer: Buffer): Promise<ParsedCustomerExcel> {
    try {
      return await parseCustomerExcel(buffer);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Invalid Excel file');
    }
  }
}
