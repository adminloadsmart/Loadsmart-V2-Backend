import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Onboarding stopped writing organizations.org_admin_name (the contact name now lives on the
 * org_admin user's full_name), so orgs signed up since then have it empty. Copies the first
 * org_admin's name into those rows.
 */
export class BackfillOrganizationOrgAdminName1793700000000 implements MigrationInterface {
  name = 'BackfillOrganizationOrgAdminName1793700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "auth"."organizations" o SET "org_admin_name" = a."full_name"
       FROM (
         SELECT DISTINCT ON (u."tenant_id") u."tenant_id", u."full_name"
         FROM "auth"."users" u
         JOIN "auth"."roles" r ON r."id" = u."role_id"
         WHERE r."name" = 'org_admin' AND u."deleted_at" IS NULL
           AND u."full_name" IS NOT NULL AND u."full_name" <> ''
         ORDER BY u."tenant_id", u."created_at" ASC
       ) a
       WHERE a."tenant_id" = o."id" AND (o."org_admin_name" IS NULL OR o."org_admin_name" = '')`,
    );
  }

  public async down(): Promise<void> {
    // The rows this filled can't be told apart from ones that already had a name.
  }
}
