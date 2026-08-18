import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Admins can reject a submitted organization document (verificationStatus = 'invalid') via
 * PATCH /admin/organizations/:organizationId/documents/:documentId, but had no column to record
 * why. Mirrors DriverEntity/CustomerEntity's rejection_reason — set on reject, cleared on any
 * other status change.
 */
export class AddRejectionReasonToOrganizationDocuments1786800100000 implements MigrationInterface {
  name = 'AddRejectionReasonToOrganizationDocuments1786800100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth"."organization_documents" ADD "rejection_reason" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth"."organization_documents" DROP COLUMN "rejection_reason"`,
    );
  }
}
