import { MigrationInterface, QueryRunner } from 'typeorm';
import { CustomerDeliveryPointEntity } from '../../modules/customers/entities/customer-delivery-point.entity';
import { CustomerEntity } from '../../modules/customers/entities/customer.entity';
import { GeofenceEntity } from '../../modules/geofences/entities/geofence.entity';
import { LoadingPointEntity } from '../../modules/masters/loading-point/entities/loading-point.entity';

/**
 * A pending loading point / pending customer's delivery points are now fenced (the geofence syncs
 * switch them on, FENCED_MASTER_STATUSES): a point added from Create trip by someone without
 * approval rights is pending, yet the trip already uses it. This switches on the geofences of the
 * points that are pending now. down() switches the same ones off again.
 */
export class FencePendingMasterPoints1795520000000 implements MigrationInterface {
  name = 'FencePendingMasterPoints1795520000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.setPendingFences(queryRunner, true);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.setPendingFences(queryRunner, false);
  }

  private async setPendingFences(queryRunner: QueryRunner, isActive: boolean): Promise<void> {
    const pendingLoadingPoints = queryRunner.manager
      .createQueryBuilder()
      .subQuery()
      .select('lp.id')
      .from(LoadingPointEntity, 'lp')
      .where("lp.status = 'pending'")
      .getQuery();
    const pendingDeliveryPoints = queryRunner.manager
      .createQueryBuilder()
      .subQuery()
      .select('p.id')
      .from(CustomerDeliveryPointEntity, 'p')
      .innerJoin(CustomerEntity, 'c', 'c.id = p.customerId')
      .where("c.status = 'pending'")
      .andWhere('p.deletedAt IS NULL')
      .getQuery();
    await queryRunner.manager
      .createQueryBuilder()
      .update(GeofenceEntity)
      .set({ isActive })
      .where('deleted_at IS NULL')
      .andWhere(
        `(loading_point_id IN ${pendingLoadingPoints} OR customer_delivery_point_id IN ${pendingDeliveryPoints})`,
      )
      .execute();
  }
}
