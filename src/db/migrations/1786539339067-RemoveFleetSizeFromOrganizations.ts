import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveFleetSizeFromOrganizations1786539339067 implements MigrationInterface {
  name = 'RemoveFleetSizeFromOrganizations1786539339067';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth"."organizations" DROP COLUMN IF EXISTS "fleet_size"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auth"."organizations" ADD "fleet_size" integer`);
  }
}
