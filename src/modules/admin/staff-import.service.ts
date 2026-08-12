import { createHash } from 'crypto';
import { parse } from 'csv-parse/sync';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../../shared/middleware/request.types';
import { ADMIN_ORGANIZATIONS_MANAGE } from '../../shared/constants/permissions';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { RoleService } from '../roles/role.service';
import { STAFF_ASSIGNABLE_ROLES } from '../../shared/constants/roles';
import { StaffImportRepository } from './staff-import.repository';
import { detectMapping, normalizeStaffRow } from './staff-import.mapper';
import { NormalizedStaffRow, StaffImportMapping } from './staff-import.types';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 500;
const required = ['fullName', 'phoneNumber', 'email', 'role', 'coverage'] as const;

export class StaffImportService {
  constructor(
    private readonly repository: StaffImportRepository,
    private readonly authService: AuthService,
    private readonly roleService: RoleService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  private assertAdmin(user: AuthenticatedUser) {
    if (user.role !== 'platform_admin' && !user.permissions.includes(ADMIN_ORGANIZATIONS_MANAGE))
      throw new ValidationError('Only a platform admin can import staff');
  }

  async preview(
    user: AuthenticatedUser,
    file: Express.Multer.File,
    requestedMapping?: StaffImportMapping,
  ) {
    try {
      this.assertAdmin(user);
      if (!file || file.size > MAX_FILE_BYTES)
        throw new ValidationError('CSV file is required and must be at most 5 MB');
      const records = parse(file.buffer, {
        columns: true,
        bom: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: false,
      }) as Record<string, string>[];
      if (!records.length)
        throw new ValidationError('CSV must contain a header and at least one data row');
      if (records.length > MAX_ROWS)
        throw new ValidationError(`CSV cannot contain more than ${MAX_ROWS} data rows`);
      const headers = Object.keys(records[0]);
      const detected = detectMapping(headers);
      const mapping = requestedMapping ?? detected.mapping;
      if (!mapping)
        throw new ValidationError('Unable to map all required CSV columns', {
          missing: detected.missing,
          ambiguous: detected.ambiguous,
          suggestions: detected.suggestions,
        });
      const rows = [];
      const seenPhones = new Set<string>();
      const seenEmails = new Set<string>();
      for (const [index, raw] of records.entries()) {
        const value = normalizeStaffRow(raw, mapping);
        const errors: Record<string, unknown>[] = [];
        if (!value.fullName)
          errors.push({ field: 'fullName', code: 'REQUIRED', message: 'Name is required' });
        if (!/^\d{10,15}$/.test(value.phoneNumber))
          errors.push({
            field: 'phoneNumber',
            code: 'INVALID',
            message: 'Phone must contain 10-15 digits',
          });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))
          errors.push({ field: 'email', code: 'INVALID', message: 'Valid email is required' });
        if (!STAFF_ASSIGNABLE_ROLES.includes(value.role as (typeof STAFF_ASSIGNABLE_ROLES)[number]))
          errors.push({
            field: 'role',
            code: 'INVALID',
            message: `Unsupported role: ${value.role}`,
          });
        if (!value.coverage)
          errors.push({ field: 'coverage', code: 'REQUIRED', message: 'Coverage is required' });
        if (seenPhones.has(value.phoneNumber))
          errors.push({
            field: 'phoneNumber',
            code: 'DUPLICATE_FILE',
            message: 'Phone is duplicated in this file',
          });
        if (seenEmails.has(value.email))
          errors.push({
            field: 'email',
            code: 'DUPLICATE_FILE',
            message: 'Email is duplicated in this file',
          });
        seenPhones.add(value.phoneNumber);
        seenEmails.add(value.email);
        let normalized: Record<string, unknown> = value;
        if (!errors.length) {
          const role = await this.roleService.findRoleByName(value.role);
          if (!role)
            errors.push({
              field: 'role',
              code: 'NOT_FOUND',
              message: `Role ${value.role} is not seeded`,
            });
          else normalized = { ...value, roleId: role.id, roleName: role.name };
        }
        rows.push({
          rowNumber: index + 2,
          status: errors.length ? 'invalid' : 'valid',
          normalizedData: normalized,
          errors: errors.length ? errors : null,
        });
      }
      const existingUsers = await this.authService.findExistingStaffContacts(
        rows
          .filter((row) => row.status === 'valid')
          .map((row) => (row.normalizedData as { phoneNumber: string }).phoneNumber),
        rows
          .filter((row) => row.status === 'valid')
          .map((row) => (row.normalizedData as { email: string }).email),
      );
      const existingPhones = new Set(existingUsers.map((existing) => existing.phoneNumber));
      const existingEmails = new Set(
        existingUsers
          .map((existing) => existing.email)
          .filter((email): email is string => Boolean(email)),
      );
      for (const row of rows) {
        if (row.status !== 'valid') continue;
        const value = row.normalizedData as { phoneNumber: string; email: string };
        const errors = row.errors ?? [];
        if (existingPhones.has(value.phoneNumber))
          errors.push({
            field: 'phoneNumber',
            code: 'DUPLICATE_DATABASE',
            message: 'Phone already belongs to a user',
          });
        if (existingEmails.has(value.email))
          errors.push({
            field: 'email',
            code: 'DUPLICATE_DATABASE',
            message: 'Email already belongs to a user',
          });
        if (errors.length) {
          row.status = 'invalid';
          row.errors = errors;
        }
      }
      const validRows = rows.filter((row) => row.status === 'valid').length;
      const staffImport = await this.repository.createImport({
        uploadedBy: user.id,
        originalFileName: file.originalname,
        fileHash: createHash('sha256').update(file.buffer).digest('hex'),
        status: 'previewed',
        mapping: mapping as unknown as Record<string, string>,
        totalRows: rows.length,
        validRows,
        invalidRows: rows.length - validRows,
      });
      await this.repository.createRows(
        rows.map((row) => ({
          ...row,
          status: row.status as 'valid' | 'invalid',
          importId: staffImport.id,
        })),
      );
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.id,
        action: 'STAFF_IMPORT_PREVIEWED',
        resourceType: 'staff_import',
        newData: { importId: staffImport.id, totalRows: rows.length, validRows },
      });
      return {
        importId: staffImport.id,
        mapping,
        summary: { totalRows: rows.length, validRows, invalidRows: rows.length - validRows },
        rows,
      };
    } catch (error) {
      rethrow(error, 'Failed to preview staff import');
    }
  }

  async commit(user: AuthenticatedUser, importId: string) {
    try {
      this.assertAdmin(user);
      const staffImport = await this.repository.findByIdForUser(importId, user.id);
      if (!staffImport) throw new NotFoundError(`Staff import ${importId} not found`);
      if (staffImport.status === 'completed') return this.result(staffImport);
      const validRows = staffImport.rows.filter((row) => row.status === 'valid');
      if (!validRows.length) throw new ConflictError('This import has no valid rows to create');
      await this.repository.updateImport(importId, { status: 'processing' });
      let successfulRows = 0;
      let failedRows = 0;
      for (const row of validRows) {
        try {
          const value = row.normalizedData as unknown as NormalizedStaffRow;
          const created = await this.authService.createStaffUser(user, {
            fullName: value.fullName,
            phoneNumber: value.phoneNumber,
            email: value.email,
            roleId: value.roleId,
            coverage: value.coverage,
          });
          await this.repository.updateRow(row.id, { status: 'created', createdUserId: created.id });
          successfulRows++;
        } catch (error) {
          await this.repository.updateRow(row.id, {
            status: 'failed',
            errors: [
              {
                code: 'CREATE_FAILED',
                message: error instanceof Error ? error.message : 'User creation failed',
              },
            ],
          });
          failedRows++;
        }
      }
      const status = failedRows ? 'failed' : 'completed';
      const result = await this.repository.updateImport(importId, {
        status,
        successfulRows,
        failedRows,
      });
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.id,
        action: status === 'failed' ? 'STAFF_IMPORT_FAILED' : 'STAFF_IMPORT_COMPLETED',
        resourceType: 'staff_import',
        newData: { importId, successfulRows, failedRows, status },
      });
      return this.result(result!);
    } catch (error) {
      rethrow(error, 'Failed to commit staff import');
    }
  }

  async get(user: AuthenticatedUser, importId: string) {
    this.assertAdmin(user);
    const value = await this.repository.findByIdForUser(importId, user.id);
    if (!value) throw new NotFoundError(`Staff import ${importId} not found`);
    return this.result(value);
  }
  private result(value: any) {
    return {
      importId: value.id,
      status: value.status,
      summary: {
        totalRows: value.totalRows,
        validRows: value.validRows,
        invalidRows: value.invalidRows,
        successfulRows: value.successfulRows,
        failedRows: value.failedRows,
      },
      mapping: value.mapping,
      rows: value.rows,
    };
  }
}
