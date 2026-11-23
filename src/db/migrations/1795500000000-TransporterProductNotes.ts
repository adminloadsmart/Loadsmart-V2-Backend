import { MigrationInterface, QueryRunner } from 'typeorm';

/** "Add Custom Notes" on the Add / Edit Transporter and Product drawers. */
export class TransporterProductNotes1795500000000 implements MigrationInterface {
  name = 'TransporterProductNotes1795500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."transporters" ADD COLUMN IF NOT EXISTS "notes" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."products" ADD COLUMN IF NOT EXISTS "notes" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "masters"."products" DROP COLUMN IF EXISTS "notes"`);
    await queryRunner.query(`ALTER TABLE "masters"."transporters" DROP COLUMN IF EXISTS "notes"`);
  }
}
