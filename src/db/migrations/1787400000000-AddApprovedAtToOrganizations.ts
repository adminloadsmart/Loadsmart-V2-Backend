import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AdminService.approveOrganization now sets approvedAt when an org transitions to 'active'
 * (see organization.entity.ts), mirroring the online_kyc_completed_at / physical_kyc_approved_at
 * milestone timestamps already on this table — but that entity column was added without a
 * migration. Adding it here so the schema matches.
 */
export class AddApprovedAtToOrganizations1787400000000 implements MigrationInterface {
  name = 'AddApprovedAtToOrganizations1787400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth"."organizations" ADD "approved_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auth"."organizations" DROP COLUMN "approved_at"`);
  }
}
