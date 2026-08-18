import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveOrganizationDocumentBooleanVerificationFields1787000000000 implements MigrationInterface {
  name = 'RemoveOrganizationDocumentBooleanVerificationFields1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth"."organization_documents" DROP COLUMN "is_govt_verified"`,
    );
    await queryRunner.query(`ALTER TABLE "auth"."organization_documents" DROP COLUMN "is_vaild"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth"."organization_documents" ADD "is_vaild" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."organization_documents" ADD "is_govt_verified" boolean NOT NULL DEFAULT false`,
    );
  }
}
