import { MigrationInterface, QueryRunner } from 'typeorm';

// Fleet Analytics' daily fixed cost charges a National Permit truck the default all-India permit
// fee when no fee is entered. VAHAN says whether a truck holds a National Permit (its rc_np_*
// fields) but nothing stored it, so: nullable — null means "not known yet" (never verified since
// this column existed), false means a state permit or none. No backfill; existing trucks pick it
// up on their next VAHAN verification.
export class AddVehicleHasNationalPermit1791400000000 implements MigrationInterface {
  name = 'AddVehicleHasNationalPermit1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "masters"."vehicles" ADD "has_national_permit" boolean`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "masters"."vehicles" DROP COLUMN "has_national_permit"`);
  }
}
