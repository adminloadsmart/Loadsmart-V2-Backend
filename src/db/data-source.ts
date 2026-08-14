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
import { MaintenanceRecordEntity } from '../modules/maintenance/maintenance.entity';
import { AuditLogEntity } from '../modules/audit/audit.entity';
import { VehicleEntity } from '../modules/masters/entities/vehicle.entity';
import { VehicleDocumentEntity } from '../modules/masters/entities/vehicle-document.entity';
import { DriverEntity } from '../modules/masters/entities/driver.entity';
import { FleetDriverLinkEntity } from '../modules/masters/entities/fleet-driver-link.entity';
import { DriverDocumentEntity } from '../modules/masters/entities/driver-document.entity';
import { DriverVerificationEntity } from '../modules/masters/entities/driver-verification.entity';
import { DriverBankDetailsEntity } from '../modules/masters/entities/driver-bank-details.entity';
import { VehicleOperationalStatusEntity } from '../modules/masters/entities/vehicle-operational-status.entity';
import { VehicleVerificationSnapshotEntity } from '../modules/masters/entities/vehicle-verification-snapshot.entity';
import { VehicleTelemetryMetaEntity } from '../modules/masters/entities/vehicle-telemetry-meta.entity';
import { VehicleServiceUsageEntity } from '../modules/masters/entities/vehicle-service-usage.entity';
import { DriverOperationalStatusEntity } from '../modules/masters/entities/driver-operational-status.entity';
import { DriverTripMetricsEntity } from '../modules/masters/entities/driver-trip-metrics.entity';
import { TruckTypeEntity } from '../modules/masters/entities/truck-type.entity';
import { LoadingPointEntity } from '../modules/masters/entities/loading-point.entity';
import { TransporterEntity } from '../modules/masters/entities/transporter.entity';
import { CustomerEntity } from '../modules/customers/entities/customer.entity';
import { CustomerDeliveryPointEntity } from '../modules/customers/entities/customer-delivery-point.entity';
import { FileEntity } from '../modules/storage/entities/file.entity';
import { CustomerImportEntity } from '../modules/customers/entities/customer-import.entity';
import { ProductEntity } from '../modules/masters/entities/product.entity';
import { ProductSubItemEntity } from '../modules/masters/entities/product-sub-item.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: env.databaseUrl,
  synchronize: !['staging', 'production'].includes(env.nodeEnv), // off on real servers, on everywhere else (local/dev/test) — see docs/rbac.md §9
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
    LoadingPointEntity,
    TransporterEntity,
    CustomerEntity,
    CustomerDeliveryPointEntity,
    FileEntity,
    CustomerImportEntity,
    ProductEntity,
    ProductSubItemEntity,
  ], // every new module adds its entity here
  // __dirname-relative + dual-ext so this resolves correctly both under ts-node (dev,
  // __dirname = src/db, matches the .ts source migrations) and compiled node (deploy,
  // __dirname = dist/db, matches the tsc-compiled .js migrations).
  migrations: [`${__dirname}/migrations/*.{js,ts}`],
});
