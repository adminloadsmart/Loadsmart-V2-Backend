import { MasterApprovalNotifier } from '../notifications/notifications.interface';
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
import { GstRateGate } from '../masters/gst/gst-rate-gate';
import { createJobQueue } from '../../jobs/queue-registry';
import { CustomerEntity } from './entities/customer.entity';
import { CustomerGstVerificationService } from './customer-gst-verification.service';
import { GST_VERIFICATION_QUEUE } from '../masters/gst/gst-background-verification';

export function createCustomersModule(
  dataSource: DataSource,
  auditService: AuditService,
  // Built by the masters module (masters/gst) — customers attach a verified GSTIN lookup on save.
  gstVerificationService: GstVerificationService,
  // The masters module's one-IDfy-GST-lookup-per-window slot, shared with the Verify button.
  gstRateGate: GstRateGate,
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
  // Bulk-imported GSTINs are verified in the background, one IDfy lookup per window.
  const gstBackgroundVerification = new CustomerGstVerificationService(
    dataSource.getRepository(CustomerEntity),
    gstVerificationService,
    gstRateGate,
    auditService,
    createJobQueue(GST_VERIFICATION_QUEUE),
  );
  const importService = new CustomerImportService(
    dataSource,
    service,
    auditService,
    gstBackgroundVerification,
  );
  const importController = new CustomerImportController(importService);
  return {
    router: createCustomerRoutes(controller, importController),
    service,
    // Run by the shared 'gst-verification' worker (composition-root.ts).
    gstBackgroundVerification,
  };
}
