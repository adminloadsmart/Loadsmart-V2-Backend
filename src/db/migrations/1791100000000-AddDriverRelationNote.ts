import { MigrationInterface, QueryRunner } from 'typeorm';

// A fleet's own free-text note about a driver ("Prefers night runs", "Ex-army"). It lives on the
// tenant's relation row, not the global driver profile, so one fleet's note is never shown to
// another fleet the same driver works for.
export class AddDriverRelationNote1791100000000 implements MigrationInterface {
  name = 'AddDriverRelationNote1791100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" ADD COLUMN IF NOT EXISTS "note" varchar(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "masters"."driver_tenant_relations" DROP COLUMN "note"`);
  }
}
