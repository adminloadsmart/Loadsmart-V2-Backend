import { ValidationError } from '../../../shared/errors';
import { ImportReport } from '../../../shared/import/report';
import { importRows } from '../../../shared/import/run';
import { ImportSource } from '../../../shared/import/upload';
import { AuditService } from '../../audit/audit.service';
import { productValidators } from './product.validators';
import { ProductService } from './product.service';
import { CreateProductInput } from './product.interface';
import { ProductRepository } from './product.repository';
import { parseProductSheet, ParsedProductSheet } from './product-import.mapper';
import { IMPORT_COLUMNS } from './product-import.columns';

const naturalKey = (input: CreateProductInput) =>
  `${input.productDetails.trim().toLowerCase()}|${input.hsnCode?.trim() ?? ''}`;

/** Settings → Products "Bulk Upload": rows validated like POST /masters/products, deduped on
 *  name + HSN (in the file and against existing products), created one by one. */
export class ProductImportService {
  constructor(
    private readonly products: ProductService,
    private readonly repository: Pick<ProductRepository, 'findByNameAndHsn'>,
    private readonly audit: AuditService,
  ) {}

  async import(
    tenantId: string,
    actorId: string,
    role: string,
    source: ImportSource,
  ): Promise<ImportReport> {
    const parsed = await this.parse(source);
    const report = await importRows(parsed, {
      columns: IMPORT_COLUMNS,
      schema: productValidators.create.shape.body,
      duplicateKey: naturalKey,
      duplicateError: {
        field: 'Product Details',
        message: 'Duplicate product name + HSN — already used by an earlier row in this file',
      },
      check: async (input) =>
        (await this.repository.findByNameAndHsn(tenantId, input.productDetails, input.hsnCode))
          ? {
              field: 'Product Details',
              message: `A product "${input.productDetails}"${input.hsnCode ? ` with HSN ${input.hsnCode}` : ''} already exists`,
            }
          : null,
      create: (input) => this.products.create(tenantId, actorId, role, input),
    });

    await this.audit.log({
      tenantId,
      userId: actorId,
      action: 'PRODUCT_BULK_IMPORTED',
      resourceType: 'product',
      newData: {
        fileName: source.fileName,
        totalRows: report.total,
        created: report.created,
        failed: report.failed,
      },
    });
    return report;
  }

  private async parse(source: ImportSource): Promise<ParsedProductSheet> {
    try {
      return await parseProductSheet(source.buffer, source.fileType);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Invalid file');
    }
  }
}
