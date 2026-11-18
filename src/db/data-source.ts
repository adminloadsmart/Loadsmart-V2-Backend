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
import { GeofenceEntity } from '../modules/geofences/entities/geofence.entity';
import { GeofenceVehicleEntity } from '../modules/geofences/entities/geofence-vehicle.entity';
import { GeofenceRecipientEntity } from '../modules/geofences/entities/geofence-recipient.entity';
import { GeofenceEventEntity } from '../modules/geofences/entities/geofence-event.entity';
import { NotificationEntity } from '../modules/notifications/notifications.entity';
import { NotificationDeliveryEntity } from '../modules/notifications/notification-delivery.entity';
import { NotificationTemplateEntity } from '../modules/notifications/templates/template.entity';
import { NotificationTypeEntity } from '../modules/notifications/entities/notification-type.entity';
import { NotificationPreferenceEntity } from '../modules/notifications/entities/notification-preference.entity';
import { NotificationQuietHoursEntity } from '../modules/notifications/entities/notification-quiet-hours.entity';
import { UserNotificationPreferenceEntity } from '../modules/notifications/entities/user-notification-preference.entity';
import { PaymentEntity } from '../modules/payments/payments.entity';
import { MaintenanceJobEntity } from '../modules/maintenance/entities/maintenance-job.entity';
import { TyreEntity } from '../modules/maintenance/entities/tyre.entity';
import { TyreReadingEntity } from '../modules/maintenance/entities/tyre-reading.entity';
import { BatteryPackEntity } from '../modules/maintenance/entities/battery-pack.entity';
import { BatterySohReadingEntity } from '../modules/maintenance/entities/battery-soh-reading.entity';
import { AuditLogEntity } from '../modules/audit/audit.entity';
import { VehicleEntity } from '../modules/masters/vehicle/entities/vehicle.entity';
import { VehicleDocumentEntity } from '../modules/masters/vehicle/entities/vehicle-document.entity';
import { DriverEntity } from '../modules/driver/entities/driver.entity';
import { DriverTenantRelationEntity } from '../modules/driver/entities/driver-tenant-relation.entity';
import { FleetDriverLinkEntity } from '../modules/masters/fleet-driver-link/entities/fleet-driver-link.entity';
import { DriverDocumentEntity } from '../modules/driver/entities/driver-document.entity';
import { DriverVerificationEntity } from '../modules/driver/entities/driver-verification.entity';
import { DriverBankDetailsEntity } from '../modules/driver/entities/driver-bank-details.entity';
import { VehicleOperationalStatusEntity } from '../modules/masters/vehicle/entities/vehicle-operational-status.entity';
import { VehicleVerificationSnapshotEntity } from '../modules/masters/vehicle/entities/vehicle-verification-snapshot.entity';
import { VehicleTelemetryMetaEntity } from '../modules/masters/vehicle/entities/vehicle-telemetry-meta.entity';
import { VehicleServiceUsageEntity } from '../modules/masters/vehicle/entities/vehicle-service-usage.entity';
import { DriverOperationalStatusEntity } from '../modules/driver/entities/driver-operational-status.entity';
import { DriverTripMetricsEntity } from '../modules/driver/entities/driver-trip-metrics.entity';
import { DriverSessionEntity } from '../modules/driver/entities/driver-session.entity';
import { TruckTypeEntity } from '../modules/masters/truck-type/entities/truck-type.entity';
import { TruckTypeCatalogEntity } from '../modules/masters/truck-type-catalog/entities/truck-type-catalog.entity';
import { LoadingPointEntity } from '../modules/masters/loading-point/entities/loading-point.entity';
import { TransporterEntity } from '../modules/masters/transporter/entities/transporter.entity';
import { TransporterContactEntity } from '../modules/masters/transporter/entities/transporter-contact.entity';
import { TransporterLaneEntity } from '../modules/masters/transporter/entities/transporter-lane.entity';
import { TransporterContractEntity } from '../modules/masters/contract/entities/transporter-contract.entity';
import { CustomerEntity } from '../modules/customers/entities/customer.entity';
import { CustomerDeliveryPointEntity } from '../modules/customers/entities/customer-delivery-point.entity';
import { CustomerContactEntity } from '../modules/customers/entities/customer-contact.entity';
import { GstVerificationEntity } from '../modules/masters/gst/entities/gst-verification.entity';
import { FileEntity } from '../modules/storage/entities/file.entity';
import { ProductEntity } from '../modules/masters/product/entities/product.entity';
import { ProductSubItemEntity } from '../modules/masters/product/entities/product-sub-item.entity';
import { RequisitionEntity } from '../modules/loads/entities/requisition.entity';
import { RequisitionItemEntity } from '../modules/loads/entities/requisition-item.entity';
import { LoadEntity } from '../modules/loads/entities/load.entity';
import { LoadCargoItemEntity } from '../modules/loads/entities/load-cargo-item.entity';
import { LoadPaymentEntity } from '../modules/loads/entities/load-payment.entity';
import { LoadActivityEntity } from '../modules/loads/entities/load-activity.entity';
import { LoadStageHistoryEntity } from '../modules/loads/entities/load-stage-history.entity';
import { LoadDocumentEntity } from '../modules/loads/documents/load-document.entity';
import { LoadRouteChangeEntity } from '../modules/loads/entities/load-route-change.entity';
import { LoadCancellationEntity } from '../modules/loads/entities/load-cancellation.entity';
import { LoadIssueReportEntity } from '../modules/loads/entities/load-issue-report.entity';
import { CodeSequenceEntity } from '../modules/loads/entities/code-sequence.entity';
import { LoadPostingEntity } from '../modules/loads/load-posting/entities/load-posting.entity';
import { LoadRecipientEntity } from '../modules/loads/load-posting/entities/load-recipient.entity';
import { LoadDraftEntity } from '../modules/loads/load-posting/entities/load-draft.entity';
import { CustomerContractEntity } from '../modules/loads/load-posting/entities/customer-contract.entity';
import { LoadBidEntity } from '../modules/loads/bids/load-bid.entity';
import { LoadMemoEntity } from '../modules/loads/memo/load-memo.entity';
import { LoadVerificationEntity } from '../modules/loads/verification/load-verification.entity';
import { LsPartnerEntity } from '../modules/loadsmart-ops/entities/ls-partner.entity';
import { LsPartnerLaneEntity } from '../modules/loadsmart-ops/entities/ls-partner-lane.entity';
import { LsCreditNoteEntity } from '../modules/loadsmart-ops/entities/ls-credit-note.entity';
import { LsReceiptEntity } from '../modules/loadsmart-ops/entities/ls-receipt.entity';
import { LsUnclaimedPaymentEntity } from '../modules/loadsmart-ops/entities/ls-unclaimed-payment.entity';
import { LsOriginalPodEntity } from '../modules/loadsmart-ops/entities/ls-original-pod.entity';
import { LsPartnerTruckTypeEntity } from '../modules/loadsmart-ops/entities/ls-partner-truck-type.entity';
import { LsPlacementRosterEntity } from '../modules/loadsmart-ops/entities/ls-placement-roster.entity';
import { LoadElrRevisionEntity } from '../modules/loads/elr/load-elr-revision.entity';
import { ElrSeriesEntity } from '../modules/loads/elr/elr-series.entity';
import { LsCommercialTermsEntity } from '../modules/loadsmart-ops/entities/ls-commercial-terms.entity';
import { LsSourcingEntity } from '../modules/loadsmart-ops/entities/ls-sourcing.entity';
import { LsPartnerBidEntity } from '../modules/loadsmart-ops/entities/ls-partner-bid.entity';
import { LoadChargeEntity } from '../modules/loads/money/load-charge.entity';
import { LsPartnerPaymentEntity } from '../modules/loadsmart-ops/entities/ls-partner-payment.entity';
import { LsCallLogEntity } from '../modules/loadsmart-ops/entities/ls-call-log.entity';
import { LsPartnerBidResponseEntity } from '../modules/loadsmart-ops/entities/ls-partner-bid-response.entity';
import { LsSourcingBrokerEntity } from '../modules/loadsmart-ops/entities/ls-sourcing-broker.entity';
import { LsStaffNotificationEntity } from '../modules/loadsmart-ops/entities/ls-staff-notification.entity';
import { LoadClaimEntity } from '../modules/loadsmart-ops/entities/load-claim.entity';
import { LoadRatingEntity } from '../modules/loadsmart-ops/entities/load-rating.entity';
import { LsInvoiceEntity } from '../modules/loadsmart-ops/entities/ls-invoice.entity';
import { LoadAwardOutcomeEntity } from '../modules/loads/entities/load-award-outcome.entity';
import { SavedViewEntity } from '../modules/analytics/saved-views/saved-view.entity';
import { SettingsVersionEntity } from '../modules/settings/settings-version.entity';

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
    // geofences module
    GeofenceEntity,
    GeofenceVehicleEntity,
    GeofenceRecipientEntity,
    GeofenceEventEntity,
    NotificationEntity,
    NotificationDeliveryEntity,
    NotificationTemplateEntity,
    NotificationTypeEntity,
    NotificationPreferenceEntity,
    NotificationQuietHoursEntity,
    UserNotificationPreferenceEntity,
    PaymentEntity,
    // maintenance module
    MaintenanceJobEntity,
    TyreEntity,
    TyreReadingEntity,
    BatteryPackEntity,
    BatterySohReadingEntity,
    AuditLogEntity,
    VehicleEntity,
    VehicleDocumentEntity,
    DriverEntity,
    DriverTenantRelationEntity,
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
    DriverSessionEntity,
    TruckTypeEntity,
    TruckTypeCatalogEntity,
    LoadingPointEntity,
    TransporterEntity,
    TransporterContactEntity,
    TransporterLaneEntity,
    TransporterContractEntity,
    CustomerEntity,
    CustomerDeliveryPointEntity,
    CustomerContactEntity,
    GstVerificationEntity,
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
    LoadStageHistoryEntity,
    LoadDocumentEntity,
    LoadRouteChangeEntity,
    LoadCancellationEntity,
    LoadIssueReportEntity,
    CodeSequenceEntity,
    LoadPostingEntity,
    LoadRecipientEntity,
    LoadDraftEntity,
    CustomerContractEntity,
    LoadBidEntity,
    LoadMemoEntity,
    LoadVerificationEntity,
    LsPartnerEntity,
    LsPartnerLaneEntity,
    LsCreditNoteEntity,
    LsReceiptEntity,
    LsUnclaimedPaymentEntity,
    LsOriginalPodEntity,
    LsPartnerTruckTypeEntity,
    LsPlacementRosterEntity,
    LoadElrRevisionEntity,
    ElrSeriesEntity,
    LsCommercialTermsEntity,
    LsSourcingEntity,
    LsPartnerBidEntity,
    LoadChargeEntity,
    LsPartnerPaymentEntity,
    LsStaffNotificationEntity,
    LsCallLogEntity,
    LsPartnerBidResponseEntity,
    LsSourcingBrokerEntity,
    LoadClaimEntity,
    LoadRatingEntity,
    LsInvoiceEntity,
    LoadAwardOutcomeEntity,
    // analytics module
    SavedViewEntity,
    // settings module (Super Admin → Settings)
    SettingsVersionEntity,
  ], // every new module adds its entity here
  // __dirname-relative + dual-ext so this resolves correctly both under ts-node (dev,
  // __dirname = src/db, matches the .ts source migrations) and compiled node (deploy,
  // __dirname = dist/db, matches the tsc-compiled .js migrations).
  migrations: [`${__dirname}/migrations/*.{js,ts}`],
  // One transaction per migration (not one for the whole run). Required because some
  // migrations set `transaction = false` to add Postgres enum values before using them,
  // and TypeORM refuses per-migration overrides when the global mode is "all".
  migrationsTransactionMode: 'each',
});
