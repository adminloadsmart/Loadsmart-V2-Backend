import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrganizationDocumentUploadFields1786787400000 implements MigrationInterface {
  name = 'AddOrganizationDocumentUploadFields1786787400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth"."organization_documents" ADD "back_file_key" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."organization_documents" ADD "is_govt_verified" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth"."organization_documents" DROP COLUMN "is_govt_verified"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."organization_documents" DROP COLUMN "back_file_key"`,
    );
  }
}
