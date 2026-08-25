import { ValidationError } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { productValidators } from './product.validators';
import { ProductService } from './product.service';
import { CreateProductInput } from './utils/product.interface';
import { parseProductExcel, ParsedProductExcel } from './product-import.mapper';

export interface ProductImportRowError {
  row: number;
  field?: string;
  message: string;
}
export interface ProductImportReport {
  totalRows: number;
  validRows: number;
  created: number;
  skipped: number;
  failed: number;
  columnMapping: Record<string, string>;
  errors: ProductImportRowError[];
}

export class ProductImportService {
  constructor(
    private readonly products: ProductService,
    private readonly audit: AuditService,
  ) {}

  async import(
    tenantId: string,
    actorId: string,
    role: string,
    fileName: string,
    buffer: Buffer,
  ): Promise<ProductImportReport> {
    const parsed = await this.parse(buffer);
    const valid: { row: number; input: CreateProductInput }[] = [];
    const errors: ProductImportRowError[] = [];
    for (const item of parsed.rows) {
      let result;
      try {
        result = productValidators.create.safeParse({ body: item.input });
      } catch (error) {
        errors.push({
          row: item.row,
          field: 'subItems',
          message: error instanceof Error ? error.message : 'Invalid row',
        });
        continue;
      }
      if (!result.success) {
        for (const issue of result.error.issues)
          errors.push({
            row: item.row,
            field: issue.path[1]?.toString() ?? issue.path[0]?.toString(),
            message: issue.message,
          });
        continue;
      }
      valid.push({ row: item.row, input: result.data.body as CreateProductInput });
    }

    const report: ProductImportReport = {
      totalRows: parsed.rows.length,
      validRows: valid.length,
      created: 0,
      skipped: 0,
      failed: errors.length,
      columnMapping: parsed.mapping,
      errors,
    };
    for (const item of valid) {
      try {
        await this.products.create(tenantId, actorId, role, item.input);
        report.created += 1;
      } catch (error) {
        report.failed += 1;
        report.errors.push({
          row: item.row,
          field: 'productDetails',
          message: error instanceof Error ? error.message : 'Failed to create product',
        });
      }
    }
    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'PRODUCT_BULK_IMPORTED',
      resourceType: 'product',
      newData: { fileName, ...report },
    });
    return report;
  }

  private async parse(buffer: Buffer): Promise<ParsedProductExcel> {
    try {
      return await parseProductExcel(buffer);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Invalid Excel file');
    }
  }
}
