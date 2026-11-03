import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The app language a driver's device last sent (Accept-Language on login, refresh or
 * device-token), so pushes to that device go out in it. Null = no preference sent → English.
 */
export class AddDriverSessionLocale1793900000000 implements MigrationInterface {
  name = 'AddDriverSessionLocale1793900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_sessions" ADD "locale" character varying(5)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "masters"."driver_sessions" DROP COLUMN "locale"`);
  }
}
