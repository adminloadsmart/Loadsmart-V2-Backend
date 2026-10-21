import { DataSource } from 'typeorm';
import { customerValidators } from './customer.validators';
import { CustomerService } from './customer.service';
import { parseCustomerSheet, ParsedCustomerSheet } from './customer-import.mapper';
import { IMPORT_COLUMNS } from './customer-import.columns';
import { CreateCustomerInput } from './customer.types';
import { CustomerEntity } from './entities/customer.entity';
import { ValidationError } from '../../shared/errors';
import {
  finishReport,
  ImportReport,
  ImportRowError,
  rowErrors,
  startReport,
} from '../../shared/import/report';
import { ImportSource } from '../../shared/import/upload';
import { AuditService } from '../audit/audit.service';
import { CustomerGstVerificationService } from './customer-gst-verification.service';

export type { ImportReport, ImportRowError } from '../../shared/import/report';

export class CustomerImportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly customers: CustomerService,
    private readonly audit: AuditService,
    private readonly gstVerification: CustomerGstVerificationService,
  ) {}

  private async inspect(
    parsed: ParsedCustomerSheet,
    tenantId: string,
  ): Promise<{
    valid: { row: number; input: CreateCustomerInput }[];
    errors: ImportRowError[];
  }> {
    const errors: ImportRowError[] = [];
    const valid: { row: number; input: CreateCustomerInput }[] = [];
    // Dedupe within the file on whichever identifier a row carries (mobile and/or GSTIN).
    const seen = new Set<string>();
    for (const item of parsed.rows) {
      const result = customerValidators.importRow.safeParse({ body: item.input });
      if (!result.success) {
        errors.push(
          ...rowErrors(
            IMPORT_COLUMNS,
            item.row,
            result.error.issues.map((issue) => ({ ...issue, path: issue.path.slice(1) })),
            item.slots,
          ),
        );
        continue;
      }
      const input = result.data.body as CreateCustomerInput;
      const keys = [
        input.mobile ? `mobile:${input.mobile}` : null,
        input.gstin ? `gstin:${input.gstin}` : null,
      ].filter((key): key is string => Boolean(key));
      const repeated = keys.find((key) => seen.has(key));
      if (repeated) {
        const isGstin = repeated.startsWith('gstin:');
        errors.push({
          row: item.row,
          field: isGstin ? 'GSTIN' : 'Mobile',
          message: `Duplicate ${isGstin ? 'GSTIN' : 'mobile number'} — already used by an earlier row in this file`,
        });
        continue;
      }
      keys.forEach((key) => seen.add(key));
      const existing = await this.findExisting(tenantId, input);
      if (existing) {
        const isGstin = Boolean(input.gstin && existing.gstin === input.gstin);
        errors.push({
          row: item.row,
          field: isGstin ? 'GSTIN' : 'Mobile',
          message: isGstin
            ? `A customer with GSTIN "${input.gstin}" already exists`
            : `A customer with mobile "${input.mobile}" already exists`,
        });
        continue;
      }
      valid.push({ row: item.row, input });
    }
    return { valid, errors };
  }

  private findExisting(tenantId: string, input: CreateCustomerInput) {
    const query = this.dataSource
      .getRepository(CustomerEntity)
      .createQueryBuilder('customer')
      .where('customer.tenant_id = :tenantId', { tenantId })
      .andWhere('customer.deleted_at IS NULL');

    if (input.gstin && input.mobile) {
      query.andWhere('(customer.mobile = :mobile OR customer.gstin = :gstin)', {
        mobile: input.mobile,
        gstin: input.gstin,
      });
    } else if (input.gstin) {
      query.andWhere('customer.gstin = :gstin', { gstin: input.gstin });
    } else {
      query.andWhere('customer.mobile = :mobile', { mobile: input.mobile });
    }

    return query.getOne();
  }

  async preview(tenantId: string, source: ImportSource): Promise<ImportReport> {
    const parsed = await this.parse(source);
    const inspected = await this.inspect(parsed, tenantId);
    return startReport(parsed, inspected.valid.length, inspected.errors);
  }

  /** Creates every valid row on its own (one bad row never rolls back the others) and queues a
   *  background GST verification for each created customer with an unverified GSTIN. */
  async import(
    tenantId: string,
    actorId: string,
    role: string,
    source: ImportSource,
  ): Promise<ImportReport> {
    const parsed = await this.parse(source);
    const inspected = await this.inspect(parsed, tenantId);
    const errors = [...inspected.errors];
    const report: ImportReport = {
      ...startReport(parsed, inspected.valid.length, errors),
      gstVerificationQueued: 0,
    };
    for (const item of inspected.valid) {
      let customer: Awaited<ReturnType<CustomerService['create']>>;
      try {
        customer = await this.customers.create(tenantId, actorId, role, item.input, 'csv_import', {
          queueGstVerification: true,
        });
        report.created += 1;
      } catch (error) {
        errors.push({
          row: item.row,
          message: error instanceof Error ? error.message : 'Failed to create customer',
        });
        continue;
      }
      if (customer.gstin && customer.gstVerificationStatus === 'pending') {
        const queued = await this.gstVerification.enqueue({
          tenantId,
          recordId: customer.id,
          actorId,
        });
        if (queued) report.gstVerificationQueued! += 1;
      }
    }
    finishReport(report);
    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'CUSTOMER_BULK_IMPORTED',
      resourceType: 'customer',
      newData: {
        fileName: source.fileName,
        totalRows: report.total,
        created: report.created,
        failed: report.failed,
        gstVerificationQueued: report.gstVerificationQueued,
      },
    });
    return report;
  }

  private async parse(source: ImportSource): Promise<ParsedCustomerSheet> {
    try {
      return await parseCustomerSheet(source.buffer, source.fileType);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Invalid file');
    }
  }
}
