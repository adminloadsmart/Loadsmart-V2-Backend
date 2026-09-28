import { NotFoundError, rethrow } from '../../../shared/errors';
import { paginate, Paginated, PaginationInput } from '../../../shared/utils/pagination';
import { DriverService, flattenRelation } from '../driver.service';
import { DriverRepository } from '../driver.repository';
import { DriverTenantRelationRepository } from '../driver-tenant-relation.repository';
import { DriverEntity } from '../entities/driver.entity';
import { DriverOperationalStatusEntity } from '../entities/driver-operational-status.entity';
import { DriverTripMetricsEntity } from '../entities/driver-trip-metrics.entity';
import { LoadService, TripsDoneResult } from '../../loads/load.service';
import { ListLoadsInput } from '../../loads/utils/load.interface';
import { TripListRow } from '../../loads/utils/trip-view';
import { NotificationsService } from '../../notifications/notifications.service';
import { ListNotificationsInput } from '../../notifications/notifications.interface';
import { OrganizationService } from '../../organization/organization.service';
import {
  DriverProfileView,
  DriverHomeView,
  DriverNotificationCategory,
  NOTIFICATION_TYPE_PREFIXES,
} from './driver-portal.types';

/**
 * The service layer behind driver-portal.controller.ts — every "tenant or not" branch and every
 * cross-service aggregation lives here, not in the controller, which should only extract request
 * data and call one method here. Mirrors the "consumer takes producer services directly" pattern
 * already used across this codebase (e.g. driver.service.ts taking storageService/
 * organizationService directly) — this is that same pattern for the driver-app's own screens.
 */
export class DriverPortalService {
  constructor(
    private readonly driverService: DriverService,
    private readonly driverRepository: DriverRepository,
    private readonly driverTenantRelationRepository: DriverTenantRelationRepository,
    private readonly organizationService: OrganizationService,
    private readonly loadService: LoadService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Profile screen for a driver with no active tenant relation yet (e.g. just finished
   * self-registration, hasn't joined a fleet owner) — just the global profile
   * (documents/verifications/bankDetails/insurances), none of the tenant-aggregated fields
   * fetchTenantProfile below adds (those need a relation: vehicle assignment, org name, trip
   * metrics). See getMyProfile, which picks this or fetchTenantProfile based on whether the
   * caller's token carries a tenantId.
   */
  private async fetchGlobalProfile(driverId: string): Promise<DriverEntity> {
    try {
      const driver = await this.driverRepository.findByIdWithPersonRelations(driverId);
      if (!driver) throw new NotFoundError(`Driver ${driverId} not found`);
      return driver;
    } catch (error) {
      rethrow(error, 'Failed to fetch driver profile');
    }
  }

  // See DriverProfileView's doc comment for which fields are real vs. explicit null.
  private async fetchTenantProfile(tenantId: string, driverId: string): Promise<DriverProfileView> {
    try {
      const relation =
        await this.driverTenantRelationRepository.findByTenantAndDriverWithProfileRelations(
          tenantId,
          driverId,
        );
      if (!relation) throw new NotFoundError(`Driver ${driverId} not found`);
      const driver = flattenRelation(relation);
      const organization = await this.organizationService.getOrganizationStatus(tenantId);

      const activeLink =
        relation.vehicleLinks?.find((link) => link.status === 'active' && link.isPrimary) ??
        relation.vehicleLinks?.find((link) => link.status === 'active') ??
        null;

      let vehicle: DriverProfileView['vehicle'] = null;
      if (activeLink) {
        const latestByExpiry = (documentType: 'insurance' | 'fitness'): string | null => {
          const matches = (activeLink.vehicle.documents ?? []).filter(
            (doc) => doc.documentType === documentType && !doc.deletedAt && doc.expiryDate,
          );
          if (matches.length === 0) return null;
          return matches.reduce((latest, doc) =>
            !latest.expiryDate || (doc.expiryDate && doc.expiryDate > latest.expiryDate)
              ? doc
              : latest,
          ).expiryDate;
        };
        vehicle = {
          registrationNumber: activeLink.vehicle.registrationNumber,
          type: activeLink.vehicle.truckType?.name ?? null,
          insuranceValidTill: latestByExpiry('insurance'),
          fitnessValidTill: latestByExpiry('fitness'),
        };
      }

      const findDocument = (types: string[]) =>
        driver.documents?.find((doc) => types.includes(doc.documentType) && !doc.deletedAt) ?? null;
      const drivingLicenceDoc = findDocument(['driving_license_front', 'driving_license_back']);
      const identityProofDoc = findDocument(['aadhaar', 'pan']);

      const metrics = (relation.tripMetrics ?? []).filter((metric) => !metric.deletedAt);
      const tripsCompleted = metrics.length
        ? metrics.reduce((sum, metric) => sum + metric.tripsCount, 0)
        : null;
      const onTimeDeliveryPercentage =
        tripsCompleted && tripsCompleted > 0
          ? Number(
              (
                metrics.reduce(
                  (sum, metric) => sum + metric.tripsCount * Number(metric.onTimePercentage),
                  0,
                ) / tripsCompleted
              ).toFixed(2),
            )
          : null;

      return {
        ...driver, // fullName, phoneNumber, documents, verifications, bankDetails, vehicleLinks, etc. — unchanged
        organizationName: organization.name,
        experienceYears: null, // not tracked — no field distinguishes this from dateOfJoining
        vehicle,
        documentStatus: {
          drivingLicence: drivingLicenceDoc
            ? { uploaded: true, verified: !!drivingLicenceDoc.verifiedAt }
            : null,
          identityProof: identityProofDoc
            ? { uploaded: true, verified: !!identityProofDoc.verifiedAt }
            : null,
        },
        performance: {
          tripsCompleted,
          onTimeDeliveryPercentage,
          kmsDriven: null, // not tracked anywhere in this build
          settlementDue: null, // no driver settlement/earnings module exists yet
        },
        settings: {
          notificationsEnabled: null, // no driver notification-preference field exists yet
          language: null, // no driver locale/language field exists yet
          locationSharing: null, // no location-sharing preference field exists yet
          appVersion: null, // client-reported, not a server-side concept
        },
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch driver profile');
    }
  }

  /** Profile screen. A driver not yet linked to any tenant still gets their own global profile
   *  back; once linked, this becomes the full aggregated view — see fetchTenantProfile's own doc
   *  comment for which fields are real data vs. explicit null. */
  getMyProfile(
    driverId: string,
    tenantId: string | null,
  ): Promise<DriverProfileView | DriverEntity> {
    return tenantId
      ? this.fetchTenantProfile(tenantId, driverId)
      : this.fetchGlobalProfile(driverId);
  }

  /** A driver with no active tenant relation has no operational status anywhere — null, not a
   *  permissions error. */
  getMyStatus(
    driverId: string,
    tenantId: string | null,
  ): Promise<DriverOperationalStatusEntity | null> {
    if (!tenantId) return Promise.resolve(null);
    return this.driverService.getOperationalStatus(tenantId, driverId);
  }

  /** Read-only ops-computed KPIs. No tenant relation means no metrics anywhere — empty array,
   *  not a permissions error. */
  getMyTripMetrics(driverId: string, tenantId: string | null): Promise<DriverTripMetricsEntity[]> {
    if (!tenantId) return Promise.resolve([]);
    return this.driverService.listTripMetrics(tenantId, driverId);
  }

  /** No tenant relation means this driver cannot be assigned to any load in any tenant — an
   *  empty page, not a permissions error. */
  getMyLoads(
    driverId: string,
    tenantId: string | null,
    query: ListLoadsInput,
  ): Promise<Paginated<TripListRow> & { counts?: { active: number; completed: number } }> {
    if (!tenantId) return Promise.resolve(paginate([], 0, query));
    return this.loadService.list(tenantId, { ...query, driverId });
  }

  /** Driver-app "Trips Done" screen — always completed-only. No tenant relation means no
   *  completed trips anywhere — a zeroed/empty result, same reasoning as getMyLoads above. */
  getMyTripsDone(
    driverId: string,
    tenantId: string | null,
    query: PaginationInput,
  ): Promise<TripsDoneResult> {
    if (!tenantId) {
      return Promise.resolve({
        ...paginate([], 0, query),
        totalTrips: 0,
        epodVerifiedPercentage: 0,
      });
    }
    return this.loadService.getMyTripsDone(tenantId, driverId, query);
  }

  /** Home screen — bundles driver name/vehicle, on-time %/trips-done stats, the current active
   *  job, the upcoming-jobs list, and the unread notification count into one call. No tenant
   *  relation means driver/notifications still populate (global profile, tenant-less inbox) but
   *  stats/jobs come back zeroed/empty — same "empty, not an error" convention as every method
   *  above. Settlement Due, Distance, and Score/Rating are deliberately not here — no backing
   *  data exists for any of them yet. */
  async getMyHome(driverId: string, tenantId: string | null): Promise<DriverHomeView> {
    const unreadNotificationCount = await this.notificationsService.countUnreadForDriver(driverId);

    if (!tenantId) {
      const driver = await this.fetchGlobalProfile(driverId);
      return {
        driver: {
          driverId: driver.id,
          fullName: driver.fullName,
          vehicleNumber: null,
          phoneNumber: driver.phoneNumber,
        },
        stats: { tripsDone: 0, onTimePercentage: null },
        currentJob: null,
        upcomingJobs: [],
        unreadNotificationCount,
      };
    }

    const [profile, tripsDone, activeJobs, upcomingJobs] = await Promise.all([
      this.fetchTenantProfile(tenantId, driverId),
      this.loadService.getMyTripsDone(tenantId, driverId, { page: 1, limit: 1 }),
      this.loadService.list(tenantId, { page: 1, limit: 1, driverId, group: 'active' }),
      this.loadService.list(tenantId, { page: 1, limit: 5, driverId, status: 'assigned' }),
    ]);

    return {
      driver: {
        driverId,
        fullName: profile.fullName,
        vehicleNumber: profile.vehicle?.registrationNumber ?? null,
        phoneNumber: profile.phoneNumber,
      },
      stats: {
        tripsDone: tripsDone.totalTrips,
        onTimePercentage: profile.performance.onTimeDeliveryPercentage,
      },
      currentJob: activeJobs.items[0] ?? null,
      upcomingJobs: upcomingJobs.items,
      unreadNotificationCount,
    };
  }

  // --- Notifications — not tenant-scoped: a driver's inbox spans every tenant relation they've
  // ever had, so these work the same whether or not tenantId is set. ---

  getMyNotifications(
    driverId: string,
    category: DriverNotificationCategory | undefined,
    query: ListNotificationsInput,
  ) {
    return this.notificationsService.listForDriver(driverId, {
      ...query,
      typePrefix: category ? NOTIFICATION_TYPE_PREFIXES[category] : undefined,
    });
  }

  markMyNotificationRead(driverId: string, notificationId: string) {
    return this.notificationsService.markReadForDriver(driverId, notificationId);
  }

  async markAllMyNotificationsRead(driverId: string): Promise<{ markedCount: number }> {
    const markedCount = await this.notificationsService.markAllReadForDriver(driverId);
    return { markedCount };
  }
}
