import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPortalToRefreshTokens1787200000000 implements MigrationInterface {
  name = 'AddPortalToRefreshTokens1787200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth"."refresh_tokens" ADD COLUMN "portal" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auth"."refresh_tokens" DROP COLUMN "portal"`);
  }
}
