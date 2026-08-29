import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds an optional free-text driver name to loads, alongside the existing driver_number (a
// phone number). Market-load Assignment only — the driver isn't necessarily in the Driver
// master, so this is independent of driver_number rather than replacing it. Own-fleet loads
// (dispatch-planning.service.ts) never populate this column.
export class AddDriverNameToLoads1788000000000 implements MigrationInterface {
  name = 'AddDriverNameToLoads1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "loads"."loads" ADD "driver_name" character varying(150)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "driver_name"`);
  }
}
