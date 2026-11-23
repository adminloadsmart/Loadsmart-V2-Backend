import { MigrationInterface, QueryRunner } from 'typeorm';
import { CustomerEntity } from '../../modules/customers/entities/customer.entity';
import { GeofenceEntity } from '../../modules/geofences/entities/geofence.entity';

interface PointRow {
  id: string;
  tenantId: string;
  location: string;
  addressLine1: string | null;
  areaLocality: string | null;
  city: string | null;
  state: string | null;
  pinCode: string | null;
  latitude: string;
  longitude: string;
  radiusM: number;
  customerName: string;
  customerStatus: string;
}

/**
 * Unloading points now get their geofence automatically (CustomerDeliveryPointGeofenceSync), like
 * loading points do. This creates one for every existing delivery point that has a pin but no
 * geofence yet. down() removes only the ones this created (same type, link and no creator).
 */
export class BackfillUnloadingPointGeofences1795490000001 implements MigrationInterface {
  name = 'BackfillUnloadingPointGeofences1795490000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const points: PointRow[] = await queryRunner.manager
      .createQueryBuilder()
      .select('p.id', 'id')
      .addSelect('p.tenant_id', 'tenantId')
      .addSelect('p.location', 'location')
      .addSelect('p.address_line_1', 'addressLine1')
      .addSelect('p.area_locality', 'areaLocality')
      .addSelect('p.city', 'city')
      .addSelect('p.state', 'state')
      .addSelect('p.pin_code', 'pinCode')
      .addSelect('p.latitude', 'latitude')
      .addSelect('p.longitude', 'longitude')
      .addSelect('p.geofence_radius_m', 'radiusM')
      .addSelect('c.name', 'customerName')
      .addSelect('c.status', 'customerStatus')
      .from('customers.customer_delivery_points', 'p')
      // Joins take the entity class: a dotted string here reads as a relation path (alias.property).
      .innerJoin(CustomerEntity, 'c', 'c.id = p.customer_id AND c.deleted_at IS NULL')
      .leftJoin(GeofenceEntity, 'g', 'g.customer_delivery_point_id = p.id AND g.deleted_at IS NULL')
      .where('p.deleted_at IS NULL')
      .andWhere('p.latitude IS NOT NULL AND p.longitude IS NOT NULL')
      .andWhere('g.id IS NULL')
      .getRawMany();
    if (points.length === 0) return;

    await queryRunner.manager
      .createQueryBuilder()
      .insert()
      .into('tracking.geofences')
      .values(
        points.map((p) => ({
          tenantId: p.tenantId,
          name: `${p.customerName} · ${p.city || p.location}`.slice(0, 150),
          type: 'unloading_point',
          address:
            [p.addressLine1, p.areaLocality, p.city, p.state, p.pinCode]
              .filter(Boolean)
              .join(', ') || p.location,
          latitude: p.latitude,
          longitude: p.longitude,
          shape: 'circle',
          radiusM: p.radiusM,
          polygon: null,
          alertOnEnter: true,
          alertOnExit: true,
          appliesToAllVehicles: true,
          customerDeliveryPointId: p.id,
          isActive: p.customerStatus === 'active',
          createdBy: null,
          updatedBy: null,
        })),
      )
      .execute();
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.manager
      .createQueryBuilder()
      .delete()
      .from('tracking.geofences')
      .where('type = :type', { type: 'unloading_point' })
      .andWhere('customer_delivery_point_id IS NOT NULL')
      .andWhere('created_by IS NULL')
      .execute();
  }
}
