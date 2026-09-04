import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { LoadService } from '../loads/load.service';
import { LoadPaymentService } from '../loads/load-payment.service';
import { LoadActivityService } from '../loads/load-activity.service';
import { TransporterService } from '../masters/transporter/transporter.service';
import { PaymentRepository } from './payment.repository';
import { PaymentsService } from './payments.service';
import { TransporterSettlementRepository } from './transporter-settlement.repository';
import { TransporterSettlementService } from './transporter-settlement.service';
import { TransporterPayablesRepository } from './transporter-payables.repository';
import { TransporterPayablesService } from './transporter-payables.service';
import { PaymentsController } from './payments.controller';
import { createPaymentsRoutes } from './payments.routes';

export function createPaymentsModule(
  dataSource: DataSource,
  deps: {
    loadService: LoadService;
    loadPaymentService: LoadPaymentService;
    transporterService: TransporterService;
    loadActivityService: LoadActivityService;
    auditService: AuditService;
  },
) {
  const repository = new PaymentRepository(dataSource);
  const service = new PaymentsService(repository);

  const transporterSettlementRepository = new TransporterSettlementRepository(dataSource);
  const transporterSettlementService = new TransporterSettlementService(
    transporterSettlementRepository,
    deps.loadService,
    deps.loadPaymentService,
    deps.transporterService,
    deps.loadActivityService,
    deps.auditService,
  );

  const transporterPayablesRepository = new TransporterPayablesRepository(dataSource);
  const transporterPayablesService = new TransporterPayablesService(transporterPayablesRepository);

  const controller = new PaymentsController(
    transporterSettlementService,
    transporterPayablesService,
  );
  const router = createPaymentsRoutes(controller);
  return { service, transporterSettlementService, transporterPayablesService, router };
}
