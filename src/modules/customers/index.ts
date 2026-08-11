import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { CustomerRepository } from './customer.repository';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { createCustomerRoutes } from './customer.routes';

export function createCustomersModule(dataSource: DataSource, auditService: AuditService) {
  const repository = new CustomerRepository(dataSource);
  const service = new CustomerService(repository, dataSource, auditService);
  const controller = new CustomerController(service);
  return { router: createCustomerRoutes(controller), service };
}
