// src/db/data-source.ts
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Client } from 'pg';
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
import { CustomerEntity } from '../modules/customers/entities/customer.entity';
import { CustomerDeliveryPointEntity } from '../modules/customers/entities/customer-delivery-point.entity';
import { FileEntity } from '../modules/storage/entities/file.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: env.databaseUrl,
  synchronize: true, // off by default — see note below on when to flip this
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
    CustomerEntity,
    CustomerDeliveryPointEntity,
    FileEntity,
  ], // every new module adds its entity here
  migrations: ['src/db/migrations/**/*.ts'],
});
