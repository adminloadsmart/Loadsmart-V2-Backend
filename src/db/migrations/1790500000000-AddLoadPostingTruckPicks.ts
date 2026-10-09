import { MigrationInterface, QueryRunner } from 'typeorm';

// Post a load now takes truck types from the fixed picker table instead of the tenant's Truck
// master, so a posting keeps the picks (body, tyres/axle, tonnes, length) it was made from.
export class AddLoadPostingTruckPicks1790500000000 implements MigrationInterface {
  name = 'AddLoadPostingTruckPicks1790500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "loads"."load_postings" ADD "truck_pick" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "loads"."load_postings" ADD "accepted_truck_picks" jsonb NOT NULL DEFAULT '[]'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."load_postings" DROP COLUMN "accepted_truck_picks"`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."load_postings" DROP COLUMN "truck_pick"`);
  }
}
