import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { errorContent, permissionGated, TAGS } from '../openapi/core';

/** OpenAPI entry for a master's GET …/import/sample (the bulk-upload template download). */
export function registerImportSampleOpenApi(
  registry: OpenAPIRegistry,
  options: {
    path: string;
    operationId: string;
    permission: string;
    label: string;
    filename: string;
  },
): void {
  registry.registerPath({
    method: 'get',
    path: options.path,
    tags: [TAGS.MASTERS],
    operationId: options.operationId,
    ...permissionGated(
      [options.permission],
      `Download the ${options.label} bulk-upload template (.xlsx): a data sheet whose columns are ` +
        'exactly the ones the import reads (with an example row and dropdowns), plus an ' +
        '"Instructions" sheet listing required columns and formats.',
    ),
    responses: {
      200: {
        description: options.filename,
        content: {
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
            schema: { type: 'string', format: 'binary' },
          },
        },
      },
      403: { description: 'Forbidden', ...errorContent },
    },
  });
}

/** Shared wording for the import endpoints' 201 response. */
export const IMPORT_REPORT_DESCRIPTION =
  'Import report: { total, validRows, created, failed, columnMapping, ignoredColumns, ' +
  'errors: [{ row, field, message }] } — rows with errors are skipped, the rest are saved.';
