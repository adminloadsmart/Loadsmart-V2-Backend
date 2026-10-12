import { DataSource } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { CustomerService } from '../../customers/customer.service';
import { VehicleService } from '../../masters/vehicle/vehicle.service';
import { DriverAuthService } from '../../driver/auth/driver-auth.service';
import { TruckTypeService } from '../../masters/truck-type/truck-type.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CodeSequenceRepository } from '../code-sequence.repository';
import { LoadRepository } from '../load.repository';
import { LoadActivityService } from '../load-activity.service';
import { LoadPostingRepository } from './load-posting.repository';
import { LoadPostingService } from './load-posting.service';
import { LoadPostingLookupService } from './load-posting-lookup.service';
import { CustomerContractService } from './customer-contract.service';
import { LoadDraftService } from './load-draft.service';
import { LoadPostingController } from './load-posting.controller';
import { createLoadPostingRoutes } from './load-posting.routes';
import { LoadDispatchNotifier, LoggingLoadDispatchNotifier } from './load-dispatch-notifier';

export function createLoadPostingModule(
  dataSource: DataSource,
  deps: {
    auditService: AuditService;
    customerService: CustomerService;
    vehicleService: VehicleService;
    loadRepository: LoadRepository;
    codeSequenceRepository: CodeSequenceRepository;
    loadActivityService: LoadActivityService;
    driverAuthService: DriverAuthService;
    notificationsService: NotificationsService;
    truckTypeService: TruckTypeService;
    /** Swap in the real WhatsApp sender here once it exists. */
    notifier?: LoadDispatchNotifier;
  },
) {
  const repository = new LoadPostingRepository(dataSource);

  const postingService = new LoadPostingService(
    dataSource,
    repository,
    deps.loadRepository,
    deps.codeSequenceRepository,
    deps.customerService,
    deps.vehicleService,
    deps.loadActivityService,
    deps.auditService,
    deps.notifier ?? new LoggingLoadDispatchNotifier(),
    deps.driverAuthService,
    deps.notificationsService,
    deps.truckTypeService,
  );
  const lookupService = new LoadPostingLookupService(
    dataSource,
    repository,
    deps.loadRepository,
    deps.customerService,
    deps.vehicleService,
    postingService,
  );
  const contractService = new CustomerContractService(repository, deps.auditService);
  const draftService = new LoadDraftService(repository);

  const controller = new LoadPostingController(
    postingService,
    lookupService,
    contractService,
    draftService,
  );

  return { postingService, lookupService, router: createLoadPostingRoutes(controller) };
}
