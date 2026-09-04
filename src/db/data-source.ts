// src/db/data-source.ts
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { env } from '../config/env';
import { OrganizationEntity } from '../modules/organization/entities/organization.entity';
import { OrganizationDocumentEntity } from '../modules/organization/entities/organization-document.entity';
import { OrganizationJourneyStageHistoryEntity } from '../modules/organization/entities/organization-journey-stage-history.entity';
import { UserEntity } from '../modules/auth/entities/user.entity';
import { ReferralCodeEntity } from '../modules/organization/entities/referral-code.entity';
import { RefreshTokenEntity } from '../modules/auth/entities/refresh-token.entity';
import { LoginAttemptEntity } from '../modules/auth/entities/login-attempt.entity';
import { RoleEntity } from '../modules/roles/entities/role.entity';
import { PermissionEntity } from '../modules/roles/entities/permission.entity';
import { UserPermissionEntity } from '../modules/roles/entities/user-permission.entity';
import { TrackingEventEntity } from '../modules/tracking/tracking.entity';
import { NotificationEntity } from '../modules/notifications/notifications.entity';
import { NotificationTemplateEntity } from '../modules/notifications/templates/template.entity';
import { PaymentEntity } from '../modules/payments/payments.entity';
import { TransporterSettlementEntity } from '../modules/payments/entities/transporter-settlement.entity';
import { MaintenanceRecordEntity } from '../modules/maintenance/maintenance.entity';
import { AuditLogEntity } from '../modules/audit/audit.entity';
import { VehicleEntity } from '../modules/masters/vehicle/entities/vehicle.entity';
import { VehicleDocumentEntity } from '../modules/masters/vehicle/entities/vehicle-document.entity';
import { DriverEntity } from '../modules/masters/driver/entities/driver.entity';
import { FleetDriverLinkEntity } from '../modules/masters/fleet-driver-link/entities/fleet-driver-link.entity';
import { DriverDocumentEntity } from '../modules/masters/driver/entities/driver-document.entity';
import { DriverVerificationEntity } from '../modules/masters/driver/entities/driver-verification.entity';
import { DriverBankDetailsEntity } from '../modules/masters/driver/entities/driver-bank-details.entity';
import { VehicleOperationalStatusEntity } from '../modules/masters/vehicle/entities/vehicle-operational-status.entity';
import { VehicleVerificationSnapshotEntity } from '../modules/masters/vehicle/entities/vehicle-verification-snapshot.entity';
import { VehicleTelemetryMetaEntity } from '../modules/masters/vehicle/entities/vehicle-telemetry-meta.entity';
import { VehicleServiceUsageEntity } from '../modules/masters/vehicle/entities/vehicle-service-usage.entity';
import { DriverOperationalStatusEntity } from '../modules/masters/driver/entities/driver-operational-status.entity';
import { DriverTripMetricsEntity } from '../modules/masters/driver/entities/driver-trip-metrics.entity';
import { TruckTypeEntity } from '../modules/masters/truck-type/entities/truck-type.entity';
import { TruckTypeCatalogEntity } from '../modules/masters/truck-type-catalog/entities/truck-type-catalog.entity';
import { LoadingPointEntity } from '../modules/masters/loading-point/entities/loading-point.entity';
import { TransporterEntity } from '../modules/masters/transporter/entities/transporter.entity';
import { CustomerEntity } from '../modules/customers/entities/customer.entity';
import { CustomerDeliveryPointEntity } from '../modules/customers/entities/customer-delivery-point.entity';
import { FileEntity } from '../modules/storage/entities/file.entity';
import { ProductEntity } from '../modules/masters/product/entities/product.entity';
import { ProductSubItemEntity } from '../modules/masters/product/entities/product-sub-item.entity';
import { RequisitionEntity } from '../modules/loads/entities/requisition.entity';
import { RequisitionItemEntity } from '../modules/loads/entities/requisition-item.entity';
import { LoadEntity } from '../modules/loads/entities/load.entity';
import { LoadCargoItemEntity } from '../modules/loads/entities/load-cargo-item.entity';
import { LoadPaymentEntity } from '../modules/loads/entities/load-payment.entity';
import { LoadActivityEntity } from '../modules/loads/entities/load-activity.entity';
import { CodeSequenceEntity } from '../modules/loads/entities/code-sequence.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: env.databaseUrl,
  // Schema changes are managed by migrations. Running synchronize before pending
  // migrations can make partially-created legacy columns fail startup.
  synchronize: false,
  logging: env.nodeEnv === 'development',
  entities: [
    OrganizationEntity,
    OrganizationDocumentEntity,
    OrganizationJourneyStageHistoryEntity,
    UserEntity,
    ReferralCodeEntity,
    RefreshTokenEntity,
    LoginAttemptEntity,
    RoleEntity,
    PermissionEntity,
    UserPermissionEntity,
    TrackingEventEntity,
    NotificationEntity,
    NotificationTemplateEntity,
    PaymentEntity,
    TransporterSettlementEntity,
    MaintenanceRecordEntity,
    AuditLogEntity,
    VehicleEntity,
    VehicleDocumentEntity,
    DriverEntity,
    FleetDriverLinkEntity,
    DriverDocumentEntity,
    DriverVerificationEntity,
    DriverBankDetailsEntity,
    VehicleOperationalStatusEntity,
    VehicleVerificationSnapshotEntity,
    VehicleTelemetryMetaEntity,
    VehicleServiceUsageEntity,
    DriverOperationalStatusEntity,
    DriverTripMetricsEntity,
    TruckTypeEntity,
    TruckTypeCatalogEntity,
    LoadingPointEntity,
    TransporterEntity,
    CustomerEntity,
    CustomerDeliveryPointEntity,
    FileEntity,
    ProductEntity,
    ProductSubItemEntity,
    // loads module
    RequisitionEntity,
    RequisitionItemEntity,
    LoadEntity,
    LoadCargoItemEntity,
    LoadPaymentEntity,
    LoadActivityEntity,
    CodeSequenceEntity,
  ], // every new module adds its entity here
  // __dirname-relative + dual-ext so this resolves correctly both under ts-node (dev,
  // __dirname = src/db, matches the .ts source migrations) and compiled node (deploy,
  // __dirname = dist/db, matches the tsc-compiled .js migrations).
  migrations: [`${__dirname}/migrations/*.{js,ts}`],
});
