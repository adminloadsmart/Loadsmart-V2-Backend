import { MasterApprovalNotifier } from '../notifications/master-approvals';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { CustomerRepository } from './customer.repository';
import { CodeSequenceRepository } from '../loads/code-sequence.repository';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { createCustomerRoutes } from './customer.routes';
import { CustomerImportService } from './customer-import.service';
import { CustomerImportController } from './customer-import.controller';
import { GstVerificationService } from '../masters/gst/gst.service';
import { MasterUsageRepository } from '../masters/masters.usage';

export function createCustomersModule(
  dataSource: DataSource,
  auditService: AuditService,
  // Built by the masters module (masters/gst) — customers attach a verified GSTIN lookup on save.
  gstVerificationService: GstVerificationService,
  // LS_N_0009/0010 — optional; see modules/notifications/master-approvals.ts.
  masterApprovalNotifier?: MasterApprovalNotifier,
) {
  const repository = new CustomerRepository(dataSource);
  const service = new CustomerService(
    repository,
    dataSource,
    auditService,
    new CodeSequenceRepository(dataSource),
    gstVerificationService,
    new MasterUsageRepository(dataSource),
    masterApprovalNotifier,
  );
  const controller = new CustomerController(service);
  const importService = new CustomerImportService(dataSource, service, auditService);
  const importController = new CustomerImportController(importService);
  return {
    router: createCustomerRoutes(controller, importController),
    service,
  };
}
