import { DataSource } from 'typeorm';
import { PaymentRepository } from './payment.repository';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { createPaymentsRoutes } from './payments.routes';

export function createPaymentsModule(dataSource: DataSource) {
  const repository = new PaymentRepository(dataSource);
  const service = new PaymentsService(repository);
  const controller = new PaymentsController(service);
  const router = createPaymentsRoutes(controller);
  return { service, router };
}
