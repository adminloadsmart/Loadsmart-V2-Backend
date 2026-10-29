import { ConflictError, NotFoundError, rethrow } from '../../../shared/errors';
import { DEFAULT_LOCALE, Locale } from '../../../shared/i18n/locales';
import { msg } from '../../../shared/i18n/translate';
import { paginate, Paginated, PaginationInput } from '../../../shared/utils/pagination';
import { DriverService, flattenRelation } from '../driver.service';
import { DriverRepository } from '../driver.repository';
import {
  DriverTenantRelationRepository,
  isInviteSendEvent,
} from '../driver-tenant-relation.repository';
import {
  AddBankDetailsInput,
  SetDriverOperationalStatusInput,
  UpdateDriverProfileData,
} from '../drivers.interface';
import { StorageService } from '../../storage/storage.service';
import { DriverEntity } from '../entities/driver.entity';
import { DriverOperationalStatusEntity } from '../entities/driver-operational-status.entity';
import { DriverTripMetricsEntity } from '../entities/driver-trip-metrics.entity';
import { LoadService, TripsDoneResult } from '../../loads/load.service';
import { ListLoadsInput } from '../../loads/utils/load.interface';
import { TripListRow } from '../../loads/utils/trip-view';
import { UPCOMING_LOAD_STATUSES } from '../../loads/utils/loads.types';
import { MAX_PAGE_SIZE } from '../../../shared/constants/pagination';
import { TrackingEtaReader, TripEta } from './tracking-eta.reader';
import { NotificationsService } from '../../notifications/notifications.service';
import { ListNotificationsInput } from '../../notifications/notifications.interface';
import { OrganizationService } from '../../organization/organization.service';
import {
  DriverProfileView,
  DriverHomeView,
  DriverHomeCurrentTrip,
  DriverHomeNextTrip,
  DriverNotificationCategory,
  DriverInviteCardStatus,
  DriverNotificationItem,
  NOTIFICATION_TYPE_PREFIXES,
} from './driver-portal.types';
import { DRIVER_INVITED_NOTIFICATION_TYPE } from '../driver.constants';
import { DriverTenantRelationEntity } from '../entities/driver-tenant-relation.entity';
import { NotificationEntity } from '../../notifications/notifications.entity';

/** The invitationId an invite card carries; null on any other notification. */
function invitationIdOf(notification: NotificationEntity): string | null {
  const invitationId = notification.metadata?.invitationId;
  return notification.type === DRIVER_INVITED_NOTIFICATION_TYPE && typeof invitationId === 'string'
    ? invitationId
    : null;
}

/** Whether this card is the invite's newest send — the one a Resend just created. That send's
 *  card is created right after the send is logged, so it's the one at or after its time. */
function isNewestSendCard(
  notification: NotificationEntity,
  relation: DriverTenantRelationEntity,
): boolean {
  const newestSend = relation.inviteTimeline.filter(isInviteSendEvent).at(-1);
  if (!newestSend) return false;
  return notification.createdAt.getTime() >= Date.parse(newestSend.at);
}

/** Where the invite behind a card stands now. A missing relation was deleted with its fleet link
 *  — nothing left to act on. */
function inviteCardStatusOf(
  notification: NotificationEntity,
  relation: DriverTenantRelationEntity | undefined,
): DriverInviteCardStatus {
  if (!relation) return 'cancelled';
  switch (relation.status) {
    case 'active':
      return 'accepted';
    case 'rejected':
      return 'declined';
    case 'cancelled':
      return 'cancelled';
    case 'pending_staff_review':
      // Re-invited by dispatch, waiting for an org admin — a new card comes with that send.
      return 'replaced';
    case 'pending_driver_review':
      if (!isNewestSendCard(notification, relation)) return 'replaced';
      return relation.inviteExpiresAt && relation.inviteExpiresAt <= new Date()
        ? 'expired'
        : 'pending';
  }
}

function toHomeCurrentTrip(
  job: TripListRow,
  organizationName: string | null,
  eta: TripEta | null,
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
    distanceKm: eta?.distanceKm ?? null,
    distanceLeftKm: eta?.remainingKm ?? null,
    etaAt: eta?.etaAt ?? null,
    etaStale: eta?.stale ?? false,
    etaSource: eta?.source ?? null,
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
    private readonly trackingEtaReader?: TrackingEtaReader,
    private readonly storageService?: StorageService,
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

      const performance = {
        tripsCompleted,
        onTimeDeliveryPercentage,
        kmsDriven: null, // not tracked anywhere in this build
        settlementDue: null, // no driver settlement/earnings module exists yet
      };
      const fleet = { tenantId, organizationName: organization.name, vehicle, performance };
      return {
        ...driver, // fullName, phoneNumber, documents, verifications, bankDetails, vehicleLinks, etc. — unchanged
        fleets: [fleet],
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
        performance,
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
   *  back; once linked, this becomes the full aggregated view with one `fleets` entry per active
   *  tenant — see fetchTenantProfile's own doc comment for which fields are real data vs.
   *  explicit null. */
  async getMyProfile(
    driverId: string,
    tenantIds: string[],
  ): Promise<DriverProfileView | DriverEntity> {
    if (tenantIds.length === 0) {
      const driver = await this.fetchGlobalProfile(driverId);
      return Object.assign(driver, {
        profilePhotoUrl: await this.profilePhotoUrlOf(driver.profilePhotoKey),
      });
    }
    const views = await Promise.all(
      tenantIds.map((tenantId) => this.fetchTenantProfile(tenantId, driverId)),
    );
    return {
      ...views[0],
      fleets: views.flatMap((view) => view.fleets),
      profilePhotoUrl: await this.profilePhotoUrlOf(views[0].profilePhotoKey),
    };
  }

  /** Self-service profile edit. `input` is already whitelisted by the validator — phone number,
   *  licence details and date of birth never reach here. A new photo must be the driver's own
   *  confirmed 'driver/profile' upload. Returns the refreshed profile. */
  async updateMyProfile(
    driverId: string,
    tenantIds: string[],
    input: Omit<UpdateDriverProfileData, 'updatedBy'>,
  ): Promise<DriverProfileView | DriverEntity> {
    try {
      if (input.profilePhotoKey) await this.assertOwnProfilePhoto(driverId, input.profilePhotoKey);
      const updated = await this.driverRepository.update(driverId, {
        ...input,
        updatedBy: driverId,
      });
      if (!updated) throw new NotFoundError(msg('errors.driver.notFoundById', { id: driverId }));
      return await this.getMyProfile(driverId, tenantIds);
    } catch (error) {
      rethrow(error, 'Failed to update driver profile');
    }
  }

  private async assertOwnProfilePhoto(driverId: string, key: string): Promise<void> {
    const { file } = await this.storageService!.getByKeyNullTenant(key);
    if (file.purpose !== 'driver/profile' || file.uploadedBy !== driverId) {
      throw new ConflictError(`File ${key} was not uploaded as your profile photo`);
    }
    if (file.status !== 'confirmed') {
      throw new ConflictError(`File ${key} must be confirmed before it can be attached`);
    }
  }

  /** Signed download URL for the driver's profile photo, or null when none is set. */
  private async profilePhotoUrlOf(key: string | null | undefined): Promise<string | null> {
    if (!key || !this.storageService) return null;
    try {
      return (await this.storageService.getByKeyNullTenant(key)).downloadUrl;
    } catch {
      return null; // a missing/expired file must not break the whole profile screen
    }
  }

  /** The driver's availability in every fleet they're linked to — an empty list with no active
   *  relation, not a permissions error. */
  async getMyStatus(
    driverId: string,
    tenantIds: string[],
  ): Promise<DriverOperationalStatusEntity[]> {
    const statuses = await Promise.all(
      tenantIds.map((tenantId) =>
        this.driverService.getOperationalStatus(tenantId, driverId).catch((error) => {
          // A fleet that hasn't recorded a status for this driver yet just has nothing to show.
          if (error instanceof NotFoundError) return null;
          throw error;
        }),
      ),
    );
    return statuses.filter((status): status is DriverOperationalStatusEntity => status !== null);
  }

  /** Read-only ops-computed KPIs across every fleet. No tenant relation means no metrics
   *  anywhere — empty array, not a permissions error. */
  async getMyTripMetrics(
    driverId: string,
    tenantIds: string[],
  ): Promise<DriverTripMetricsEntity[]> {
    const perTenant = await Promise.all(
      tenantIds.map((tenantId) => this.driverService.listTripMetrics(tenantId, driverId)),
    );
    return perTenant.flat();
  }

  /** Availability is per fleet relation, so one change from the driver applies to all of them. */
  async setMyStatus(
    driverId: string,
    tenantIds: string[],
    input: SetDriverOperationalStatusInput,
  ): Promise<DriverOperationalStatusEntity[]> {
    return Promise.all(
      tenantIds.map((tenantId) =>
        this.driverService.setOperationalStatus(tenantId, driverId, driverId, input),
      ),
    );
  }

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
    tenantIds: string[],
    query: ListLoadsInput,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<Paginated<TripListRow> & { counts?: { active: number; completed: number } }> {
    if (tenantIds.length === 0) return Promise.resolve(paginate([], 0, query));
    return this.loadService.list(tenantIds, { ...query, driverId }, locale);
  }

  /** Driver-app "Trips Done" screen — always completed-only. No tenant relation means no
   *  completed trips anywhere — a zeroed/empty result, same reasoning as getMyLoads above. */
  getMyTripsDone(
    driverId: string,
    tenantIds: string[],
    query: PaginationInput,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<TripsDoneResult> {
    if (tenantIds.length === 0) {
      return Promise.resolve({
        ...paginate([], 0, query),
        totalTrips: 0,
        epodVerifiedPercentage: 0,
      });
    }
    return this.loadService.getMyTripsDone(tenantIds, driverId, query, locale);
  }

  /** Home screen — bundles driver name/vehicle, on-time %/trips-done/open-trips stats, the
   *  current active job, the upcoming-jobs list, and the unread notification count into one
   *  call. `stats.openTrips` counts this driver's non-'closed' loads (group: 'open' — see
   *  loads.types.ts's OPEN_LOAD_STATUSES), backing the "Open Trips" tab; it's independent of
   *  `stats.tripsDone` and the two can double-count a delivered load pending E-POD review —
   *  that's intentional, they answer different questions. No tenant relation means driver/
   *  notifications still populate (global profile, tenant-less inbox) but stats/jobs come back
   *  zeroed/empty — same "empty, not an error" convention as every method above. Settlement Due,
   *  Distance, and Score/Rating are deliberately not here — no backing data exists for any of
   *  them yet. */
  async getMyHome(
    driverId: string,
    tenantIds: string[],
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<DriverHomeView> {
    const unreadNotificationCount = await this.notificationsService.countUnreadForDriver(driverId);

    if (tenantIds.length === 0) {
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

    const [profile, tripsDone, openTrips] = await Promise.all([
      this.getMyProfile(driverId, tenantIds) as Promise<DriverProfileView>,
      this.loadService.getMyTripsDone(tenantIds, driverId, { page: 1, limit: 1 }, locale),
      this.loadService.list(
        tenantIds,
        { page: 1, limit: MAX_PAGE_SIZE, driverId, group: 'open' },
        locale,
      ),
    ]);
    // One open-loads fetch split in code, so a load is never both current and next: a trip already
    // moving wins; otherwise the driver's earliest-pickup assigned load becomes the current trip
    // (a driver whose first trip was just assigned sees it as current, not "upcoming"), and the
    // remaining assigned loads are what's next.
    const moving = openTrips.items.filter((job) => !UPCOMING_LOAD_STATUSES.includes(job.status));
    const assigned = openTrips.items
      .filter((job) => UPCOMING_LOAD_STATUSES.includes(job.status))
      .sort(
        (a, b) =>
          (a.pickupDate ?? '9999-12-31').localeCompare(b.pickupDate ?? '9999-12-31') ||
          a.createdAt.localeCompare(b.createdAt),
      );
    const currentJob = moving[0] ?? assigned[0] ?? null;
    const upcomingJobs = assigned.filter((job) => job.id !== currentJob?.id).slice(0, 5);
    const currentEta = currentJob
      ? ((await this.trackingEtaReader?.getTripEta(currentJob.id)) ?? null)
      : null;
    const organizationOf = (job: TripListRow) =>
      profile.fleets.find((fleet) => fleet.tenantId === job.tenantId)?.organizationName ?? null;

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
      currentJob,
      upcomingJobs,
      currentTrip: currentJob
        ? toHomeCurrentTrip(currentJob, organizationOf(currentJob), currentEta)
        : null,
      nextTrip: upcomingJobs[0]
        ? toHomeNextTrip(upcomingJobs[0], organizationOf(upcomingJobs[0]))
        : null,
      money: { cashHeld: null, organizationName: profile.organizationName },
      unreadNotificationCount,
    };
  }

  // --- Notifications — not tenant-scoped: a driver's inbox spans every tenant relation they've
  // ever had, so these work the same whether or not tenantId is set. ---

  /**
   * Each "You've been invited" card also gets its invite's live state (`invitation`): every Resend
   * adds a card for the same invite, and only the newest send's card is actionable — older ones
   * read `replaced`, and every card follows the invite once it's accepted, declined, cancelled or
   * expired. Nothing is deleted; the cards and the invite's timeline stay as they are.
   */
  async getMyNotifications(
    driverId: string,
    category: DriverNotificationCategory | undefined,
    query: ListNotificationsInput,
  ): Promise<Paginated<DriverNotificationItem>> {
    const page = await this.notificationsService.listForDriver(driverId, {
      ...query,
      typePrefix: category ? NOTIFICATION_TYPE_PREFIXES[category] : undefined,
    });
    const invitationIds = [
      ...new Set(page.items.map(invitationIdOf).filter((id): id is string => id !== null)),
    ];
    const relations = await this.driverTenantRelationRepository.findByIdsForDriver(
      driverId,
      invitationIds,
    );
    const relationsById = new Map(relations.map((relation) => [relation.id, relation]));

    return {
      ...page,
      items: page.items.map((notification) => {
        const invitationId = invitationIdOf(notification);
        if (!invitationId) return { ...notification, invitation: null };
        const status = inviteCardStatusOf(notification, relationsById.get(invitationId));
        return {
          ...notification,
          invitation: { invitationId, status, actionable: status === 'pending' },
        };
      }),
    };
  }

  /** Marks one of the driver's notifications read. An invite counts as opened only when its
   *  WhatsApp message is read (DriverService.recordInviteWhatsAppStatus), not from this. */
  markMyNotificationRead(driverId: string, notificationId: string) {
    return this.notificationsService.markReadForDriver(driverId, notificationId);
  }

  async markAllMyNotificationsRead(driverId: string): Promise<{ markedCount: number }> {
    const markedCount = await this.notificationsService.markAllReadForDriver(driverId);
    return { markedCount };
  }
}
