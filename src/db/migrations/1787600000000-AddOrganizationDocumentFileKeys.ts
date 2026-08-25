import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrganizationDocumentFileKeys1787600000000 implements MigrationInterface {
  name = 'AddOrganizationDocumentFileKeys1787600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auth"."organization_documents" ADD "file_keys" jsonb`);
    await queryRunner.query(`
      UPDATE "auth"."organization_documents"
      SET "file_keys" = jsonb_build_array("file_key")
      WHERE "file_key" IS NOT NULL AND "file_keys" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auth"."organization_documents" DROP COLUMN "file_keys"`);
  }
}
