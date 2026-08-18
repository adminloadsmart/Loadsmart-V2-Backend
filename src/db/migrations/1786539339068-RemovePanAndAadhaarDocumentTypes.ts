import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemovePanAndAadhaarDocumentTypes1786539339068 implements MigrationInterface {
  name = 'RemovePanAndAadhaarDocumentTypes1786539339068';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Cast to text rather than comparing the enum column straight against the literals: on a
    // database whose enum type never had 'pan'/'aadhaar' as labels in the first place (e.g. a
    // local DB synced from entities after those values were already removed, before migrations
    // existed), Postgres fails to parse the literals as that enum type before this query even
    // runs, even though no row could possibly hold those values anyway.
    await queryRunner.query(
      `DELETE FROM "auth"."organization_documents" WHERE "document_type"::text IN ('pan', 'aadhaar')`,
    );
    await queryRunner.query(
      `ALTER TYPE "auth"."organization_documents_document_type_enum" RENAME TO "organization_documents_document_type_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "auth"."organization_documents_document_type_enum" AS ENUM('gst_certificate', 'udyam', 'cin', 'shop_establishment')`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."organization_documents" ALTER COLUMN "document_type" TYPE "auth"."organization_documents_document_type_enum" USING "document_type"::text::"auth"."organization_documents_document_type_enum"`,
    );
    await queryRunner.query(`DROP TYPE "auth"."organization_documents_document_type_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "auth"."organization_documents_document_type_enum" RENAME TO "organization_documents_document_type_enum_new"`,
    );
    await queryRunner.query(
      `CREATE TYPE "auth"."organization_documents_document_type_enum" AS ENUM('gst_certificate', 'pan', 'udyam', 'aadhaar', 'cin', 'shop_establishment')`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."organization_documents" ALTER COLUMN "document_type" TYPE "auth"."organization_documents_document_type_enum" USING "document_type"::text::"auth"."organization_documents_document_type_enum"`,
    );
    await queryRunner.query(`DROP TYPE "auth"."organization_documents_document_type_enum_new"`);
  }
}
