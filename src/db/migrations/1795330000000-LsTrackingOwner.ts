import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

/** "Claim this load as mine" for Tracking: the Tracking member who runs a Loadsmart load. */
export class LsTrackingOwner1795330000000 implements MigrationInterface {
  name = 'LsTrackingOwner1795330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('loads.ls_sourcings', [
      new TableColumn({ name: 'tracking_owner_id', type: 'uuid', isNullable: true }),
      new TableColumn({ name: 'tracking_claimed_at', type: 'timestamptz', isNullable: true }),
    ]);
    await queryRunner.createIndex(
      'loads.ls_sourcings',
      new TableIndex({
        name: 'ls_sourcings_tracking_owner_idx',
        columnNames: ['tracking_owner_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('loads.ls_sourcings', 'ls_sourcings_tracking_owner_idx');
    await queryRunner.dropColumns('loads.ls_sourcings', [
      'tracking_owner_id',
      'tracking_claimed_at',
    ]);
  }
}
