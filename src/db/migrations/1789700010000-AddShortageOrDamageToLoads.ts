import { MigrationInterface, QueryRunner } from 'typeorm';

// Driver-app ePOD screen redesign: adds the cargo-condition-on-arrival fields (shortageOrDamage,
// numberOfTonnesShort, damagePhotoKey) alongside the existing E-POD columns, and relaxes
// pod_receiver_designation/seal_status to nullable at the DB level — they were already only
// enforced by the Zod validator (uploadPodBody), never a NOT NULL constraint, but the column
// comment/intent is documented here for anyone reading the schema directly.
export class AddShortageOrDamageToLoads1789700010000 implements MigrationInterface {
  name = 'AddShortageOrDamageToLoads1789700010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "loads"."loads_shortage_or_damage_enum" AS ENUM('none', 'shortage', 'damage', 'both')`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD "shortage_or_damage" "loads"."loads_shortage_or_damage_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD "number_of_tonnes_short" numeric(10,2)`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."loads" ADD "damage_photo_key" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "damage_photo_key"`);
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "number_of_tonnes_short"`);
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "shortage_or_damage"`);
    await queryRunner.query(`DROP TYPE "loads"."loads_shortage_or_damage_enum"`);
  }
}
