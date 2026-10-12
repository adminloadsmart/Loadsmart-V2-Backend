import { NotFoundError, rethrow } from '../../../shared/errors';
import { DEFAULT_LOCALE, Locale } from '../../../shared/i18n/locales';
import { msg } from '../../../shared/i18n/translate';
import { paginate, Paginated, PaginationInput } from '../../../shared/utils/pagination';
import { DriverService, flattenRelation } from '../driver.service';
import { DriverRepository } from '../driver.repository';
import { DriverTenantRelationRepository } from '../driver-tenant-relation.repository';
import { AddBankDetailsInput } from '../drivers.interface';
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
  DriverHomeCurrentTrip,
  DriverHomeNextTrip,
  DriverNotificationCategory,
  NOTIFICATION_TYPE_PREFIXES,
} from './driver-portal.types';

function toHomeCurrentTrip(
  job: TripListRow,
  organizationName: string | null,
): DriverHomeCurrentTrip {
  const destination = job.route
    ? { location: job.route.deliveryPointLocation, city: job.route.deliveryPointCity }
    : null;
  return {
    id: job.id,
    code: job.code,
    status: job.status,
    organizationName,
    origin: job.route
      ? { title: job.route.loadingPointTitle, city: job.route.loadingPointCity }
      : null,
    destination,
    distanceLeftKm: null,
    etaAt: null,
    directionsQuery: destination
      ? [destination.location, destination.city].filter(Boolean).join(', ')
      : null,
  };
}

function toHomeNextTrip(job: TripListRow, organizationName: string | null): DriverHomeNextTrip {
  return {
    id: job.id,
    code: job.code,
    organizationName,
    origin: job.route
      ? { title: job.route.loadingPointTitle, city: job.route.loadingPointCity }
      : null,
    destination: job.route
      ? { location: job.route.deliveryPointLocation, city: job.route.deliveryPointCity }
      : null,
    pickupDate: job.pickupDate,
  };
}

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
      if (!driver) throw new NotFoundError(msg('errors.driver.notFoundById', { id: driverId }));
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
      if (!relation) throw new NotFoundError(msg('errors.driver.notFoundById', { id: driverId }));
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
  /** Bank-account preflight — see DriverService.checkBankAccount. Nothing is saved. */
  checkMyBankAccount(accountNumber: string, ifsc: string) {
    return this.driverService.checkBankAccount(accountNumber, ifsc);
  }

  /** Saves the account (works with or without a tenant relation); the IDfy check is re-run
   *  in-request and its result stored — see DriverService.addOwnBankDetails. */
  addMyBankDetails(driverId: string, input: AddBankDetailsInput) {
    return this.driverService.addOwnBankDetails(driverId, input);
  }

  async listMyBankDetails(driverId: string) {
    try {
      return await this.driverRepository.listBankDetails(driverId);
    } catch (error) {
      rethrow(error, 'Failed to list bank details');
    }
  }

  getMyLoads(
    driverId: string,
    tenantId: string | null,
    query: ListLoadsInput,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<Paginated<TripListRow> & { counts?: { active: number; completed: number } }> {
    if (!tenantId) return Promise.resolve(paginate([], 0, query));
    return this.loadService.list(tenantId, { ...query, driverId }, locale);
  }

  /** Driver-app "Trips Done" screen — always completed-only. No tenant relation means no
   *  completed trips anywhere — a zeroed/empty result, same reasoning as getMyLoads above. */
  getMyTripsDone(
    driverId: string,
    tenantId: string | null,
    query: PaginationInput,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<TripsDoneResult> {
    if (!tenantId) {
      return Promise.resolve({
        ...paginate([], 0, query),
        totalTrips: 0,
        epodVerifiedPercentage: 0,
      });
    }
    return this.loadService.getMyTripsDone(tenantId, driverId, query, locale);
  }

  /** Home screen — bundles driver name/vehicle, on-time %/trips-done/open-trips stats, the
   *  current active job, the upcoming-jobs list, and the unread notification count into one
   *  call. `stats.openTrips` counts this driver's non-'closed' loads (group: 'open' — see
   *  loads.types.ts's OPEN_LOAD_STATUSES), backing the "Open Trips" tab; it's independent of
   *  `stats.tripsDone` and the two can double-count a 'delivered' load pending E-POD review —
   *  that's intentional, they answer different questions. No tenant relation means driver/
   *  notifications still populate (global profile, tenant-less inbox) but stats/jobs come back
   *  zeroed/empty — same "empty, not an error" convention as every method above. Settlement Due,
   *  Distance, and Score/Rating are deliberately not here — no backing data exists for any of
   *  them yet. */
  async getMyHome(
    driverId: string,
    tenantId: string | null,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<DriverHomeView> {
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
        stats: { tripsDone: 0, onTimePercentage: null, openTrips: 0 },
        currentJob: null,
        upcomingJobs: [],
        currentTrip: null,
        nextTrip: null,
        money: { cashHeld: null, organizationName: null },
        unreadNotificationCount,
      };
    }

    const [profile, tripsDone, activeJobs, upcomingJobs, openTrips] = await Promise.all([
      this.fetchTenantProfile(tenantId, driverId),
      this.loadService.getMyTripsDone(tenantId, driverId, { page: 1, limit: 1 }, locale),
      this.loadService.list(tenantId, { page: 1, limit: 1, driverId, group: 'active' }, locale),
      this.loadService.list(tenantId, { page: 1, limit: 5, driverId, status: 'assigned' }, locale),
      this.loadService.list(tenantId, { page: 1, limit: 1, driverId, group: 'open' }, locale),
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
        openTrips: openTrips.total,
      },
      currentJob: activeJobs.items[0] ?? null,
      upcomingJobs: upcomingJobs.items,
      currentTrip: activeJobs.items[0]
        ? toHomeCurrentTrip(activeJobs.items[0], profile.organizationName)
        : null,
      nextTrip: upcomingJobs.items[0]
        ? toHomeNextTrip(upcomingJobs.items[0], profile.organizationName)
        : null,
      money: { cashHeld: null, organizationName: profile.organizationName },
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

  /**
   * Opening the "You've been invited" notification (push tap or in-app list) is what marks that
   * invitation viewed for the fleet owner's drawer — see DriverPushNotifier.notifyInvited, which
   * stores the invitationId on the notification. Device comes from the calling session.
   */
  async markMyNotificationRead(driverId: string, notificationId: string, sessionId?: string) {
    const notification = await this.notificationsService.markReadForDriver(
      driverId,
      notificationId,
    );
    const invitationId = notification.metadata?.invitationId;
    if (notification.type === 'driver.account.invited' && typeof invitationId === 'string') {
      await this.driverTenantRelationRepository.markInviteViewed(
        invitationId,
        driverId,
        notification.createdAt,
        sessionId,
      );
    }
    return notification;
  }

  async markAllMyNotificationsRead(driverId: string): Promise<{ markedCount: number }> {
    const markedCount = await this.notificationsService.markAllReadForDriver(driverId);
    return { markedCount };
  }
}
