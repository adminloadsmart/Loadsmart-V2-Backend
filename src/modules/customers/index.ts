import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { CustomerRepository } from './customer.repository';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';
import { createCustomerRoutes } from './customer.routes';
import { CustomerImportService } from './customer-import.service';
import { CustomerImportController } from './customer-import.controller';

export function createCustomersModule(dataSource: DataSource, auditService: AuditService) {
  const repository = new CustomerRepository(dataSource);
  const service = new CustomerService(repository, dataSource, auditService);
  const controller = new CustomerController(service);
  const importService = new CustomerImportService(dataSource, service, auditService);
  const importController = new CustomerImportController(importService);
  return {
    router: createCustomerRoutes(controller, importController),
    service,
  };
}
