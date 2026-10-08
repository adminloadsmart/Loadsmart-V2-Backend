import { DataSource, In, IsNull } from 'typeorm';
import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../../shared/errors';
import { msg } from '../../../shared/i18n/translate';
import { toDateString } from '../../../shared/utils/date';
import { normalizePhoneNumber } from '../../../shared/utils/phone-number';
import { blockToken } from '../../../shared/utils/token-blocklist';
import { AuditService } from '../../audit/audit.service';
import { NotifyByType } from '../../notifications/notify-by-type';
import { NOTIFICATION_CATALOG } from '../../notifications/catalog/notification-catalog';
import { LoadEntity } from '../../loads/entities/load.entity';
import { LoadStatus } from '../../loads/utils/loads.types';
import { FleetDriverLinkEntity } from '../../masters/fleet-driver-link/entities/fleet-driver-link.entity';
import { DriverRepository } from '../driver.repository';
import { DriverTenantRelationRepository } from '../driver-tenant-relation.repository';
import { DriverSessionRepository } from './driver-auth.repository';
import { DeleteDriverAccountInput } from './driver-auth.types';

/** Trip/settlement history is kept this long after deletion before personal data is scrubbed. */
export const DRIVER_ACCOUNT_RETENTION_DAYS = 90;

// A load in one of these statuses has the driver physically on a trip — deletion is refused
// until it finishes. Loads still `created`/`assigned` are released instead (see deleteAccount).
const IN_MOTION_LOAD_STATUSES: LoadStatus[] = [
  'at_plant',
  'loading_confirmed',
  'in_transit',
  'reached_delivery_point',
];

/**
 * A driver deleting their own account from the app. This is a soft delete: masters.drivers.deleted_at
 * is set, which on its own already locks the driver out (every driver lookup — OTP login, refresh,
 * the driverAuth middleware — filters deleted_at IS NULL) and frees the phone number for a fresh
 * sign-up. Personal data stays on the row for DRIVER_ACCOUNT_RETENTION_DAYS so retained trip
 * history still resolves to a name; scrubbing it afterwards is a separate job.
 */
export class DriverAccountService {
  constructor(
    private readonly driverRepository: DriverRepository,
    private readonly driverTenantRelationRepository: DriverTenantRelationRepository,
    private readonly driverSessionRepository: DriverSessionRepository,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly notifyByType: NotifyByType,
  ) {}

  async deleteAccount(driverId: string, input: DeleteDriverAccountInput) {
    try {
      const driver = await this.driverRepository.findById(driverId);
      if (!driver) throw new NotFoundError(msg('errors.driver.notFound'));

      // The typed number is the user's "are you sure" check, not a second auth factor — they are
      // already logged in. It still has to be a valid number that equals the registered one.
      const typed = normalizePhoneNumber(input.phoneNumber);
      if (!typed || typed !== driver.phoneNumber) {
        throw new ValidationError(msg('errors.driver.phoneMismatch'));
      }

      const retentionUntil = new Date(
        Date.now() + DRIVER_ACCOUNT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );

      const linkedTenantIds = await this.dataSource.transaction(async (manager) => {
        const loads = manager.getRepository(LoadEntity);

        const inMotion = await loads.count({
          where: { driverId, status: In(IN_MOTION_LOAD_STATUSES) },
        });
        if (inMotion > 0) {
          throw new ConflictError(msg('errors.driver.deleteBlockedActiveLoad'));
        }

        // Not started yet — release the driver rather than leaving a load pointed at a deleted
        // profile. An `assigned` load goes back to `created` since it no longer has a driver.
        const released = { driverId: null, driverNumber: null, driverName: null };
        await loads.update({ driverId, status: 'assigned' }, { ...released, status: 'created' });
        await loads.update({ driverId, status: 'created' }, released);

        const relations = await this.driverTenantRelationRepository.listByDriver(driverId);
        for (const relation of relations) {
          await this.driverTenantRelationRepository.softDelete(
            relation.tenantId,
            driverId,
            null,
            manager,
          );
        }

        // Frees any vehicle's primary-driver slot this driver was holding.
        await manager.getRepository(FleetDriverLinkEntity).update(
          { driverId, deletedAt: IsNull() },
          {
            status: 'ended',
            isPrimary: false,
            linkedTo: toDateString(new Date()),
            deletedAt: new Date(),
            updatedBy: null,
          },
        );

        await this.driverRepository.softDeletePersonData(driverId, manager);
        await this.driverSessionRepository.revokeAndClearDevicesForDriver(driverId, manager);
        await this.driverRepository.softDeleteAccount(driverId, retentionUntil, manager);

        await this.auditService.log(
          {
            tenantId: null,
            userId: null,
            action: 'DRIVER_ACCOUNT_DELETED',
            resourceType: 'driver',
            oldData: { id: driverId },
            newData: { id: driverId, purgeAfter: retentionUntil.toISOString() },
          },
          manager,
        );

        return relations
          .filter((relation) => relation.status === 'active')
          .map((relation) => relation.tenantId);
      });

      // The current access token is otherwise valid until it expires (the driverAuth middleware
      // would reject it anyway via findById, this just closes the window explicitly).
      await blockToken(input.jti, input.exp);

      for (const tenantId of linkedTenantIds) {
        await this.notifyByType(NOTIFICATION_CATALOG, 'driver.account_deleted', tenantId, {
          driverName: driver.fullName,
          phoneNumber: driver.phoneNumber,
        }).catch(() => {
          // Best-effort — the deletion has already committed; see requestJoin's note.
        });
      }

      return {
        referenceId: `DEL-${driverId.slice(0, 4).toUpperCase()}-${Date.now().toString(36).toUpperCase().slice(-2)}`,
        status: 'decommissioned' as const,
        retentionUntil,
      };
    } catch (error) {
      rethrow(error, 'Failed to delete driver account');
    }
  }
}
