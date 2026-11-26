import { MigrationInterface, QueryRunner } from 'typeorm';
import { CustomerDeliveryPointEntity } from '../../modules/customers/entities/customer-delivery-point.entity';
import { CustomerEntity } from '../../modules/customers/entities/customer.entity';
import { GeofenceEntity } from '../../modules/geofences/entities/geofence.entity';
import { LoadingPointEntity } from '../../modules/masters/loading-point/entities/loading-point.entity';
import { FENCED_MASTER_STATUSES } from '../../shared/constants/location-source';

const join = (parts: Array<string | null>) => parts.filter(Boolean).join(', ');

/**
 * Some loading / unloading points have a pin but no geofence, so arrival there was never
 * detected: ones typed on Post a load (saved without the masters' geofence syncs), and pending
 * points from before pending ones were fenced (FencePendingMasterPoints only switched on
 * geofences that already existed). This creates the missing ones, the same as the syncs would
 * (LoadingPointGeofenceSync / CustomerDeliveryPointGeofenceSync). From now on Post a load fences
 * its points itself (MasterPointGeofences).
 *
 * down() is a no-op: these are the geofences the points should always have had, and loads already
 * on the road may depend on them.
 */
export class BackfillMissingPointGeofences1795530000000 implements MigrationInterface {
  name = 'BackfillMissingPointGeofences1795530000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.backfillLoadingPoints(queryRunner);
    await this.backfillDeliveryPoints(queryRunner);
  }

  public async down(): Promise<void> {
    // Intentionally empty (see the class comment).
  }

  private async backfillLoadingPoints(queryRunner: QueryRunner): Promise<void> {
    const points = await queryRunner.manager
      .createQueryBuilder(LoadingPointEntity, 'lp')
      .leftJoin(GeofenceEntity, 'g', 'g.loadingPointId = lp.id AND g.deletedAt IS NULL')
      .where('lp.deletedAt IS NULL')
      .andWhere('lp.latitude IS NOT NULL AND lp.longitude IS NOT NULL')
      .andWhere('g.id IS NULL')
      .getMany();
    if (points.length === 0) return;

    await queryRunner.manager
      .createQueryBuilder()
      .insert()
      .into(GeofenceEntity)
      .values(
        points.map((p) => ({
          tenantId: p.tenantId,
          name: p.title,
          type: 'loading_point' as const,
          address: join([p.addressLine1, p.city, p.state, p.pinCode]),
          latitude: p.latitude as string,
          longitude: p.longitude as string,
          shape: 'circle' as const,
          radiusM: p.geofenceRadiusM,
          polygon: null,
          alertOnEnter: true,
          alertOnExit: true,
          dwellAlertMinutes: null,
          engineOnAlertMinutes: null,
          appliesToAllVehicles: true,
          loadingPointId: p.id,
          customerDeliveryPointId: null,
          isActive: FENCED_MASTER_STATUSES.includes(p.status),
          createdBy: null,
          updatedBy: null,
        })),
      )
      .execute();
  }

  private async backfillDeliveryPoints(queryRunner: QueryRunner): Promise<void> {
    const points = await queryRunner.manager
      .createQueryBuilder(CustomerDeliveryPointEntity, 'p')
      .innerJoin(CustomerEntity, 'c', 'c.id = p.customerId AND c.deletedAt IS NULL')
      .leftJoin(GeofenceEntity, 'g', 'g.customerDeliveryPointId = p.id AND g.deletedAt IS NULL')
      .select('p')
      .addSelect('c.name', 'customerName')
      .addSelect('c.status', 'customerStatus')
      .where('p.deletedAt IS NULL')
      .andWhere('p.latitude IS NOT NULL AND p.longitude IS NOT NULL')
      .andWhere('g.id IS NULL')
      .getRawAndEntities();
    if (points.entities.length === 0) return;
    const customerOf = new Map(
      (points.raw as Array<{ p_id: string; customerName: string; customerStatus: string }>).map(
        (row) => [row.p_id, row],
      ),
    );

    await queryRunner.manager
      .createQueryBuilder()
      .insert()
      .into(GeofenceEntity)
      .values(
        points.entities.map((p) => {
          const raw = customerOf.get(p.id)!;
          return {
            tenantId: p.tenantId,
            name: `${raw.customerName} · ${p.city || p.location}`.slice(0, 150),
            type: 'unloading_point' as const,
            address:
              join([p.addressLine1, p.areaLocality, p.city, p.state, p.pinCode]) || p.location,
            latitude: p.latitude as string,
            longitude: p.longitude as string,
            shape: 'circle' as const,
            radiusM: p.geofenceRadiusM,
            polygon: null,
            alertOnEnter: true,
            alertOnExit: true,
            dwellAlertMinutes: null,
            engineOnAlertMinutes: null,
            appliesToAllVehicles: true,
            loadingPointId: null,
            customerDeliveryPointId: p.id,
            isActive: FENCED_MASTER_STATUSES.includes(raw.customerStatus),
            createdBy: null,
            updatedBy: null,
          };
        }),
      )
      .execute();
  }
}
