import { MigrationInterface, QueryRunner } from 'typeorm';

import { STAFF_TEAMS } from '../../shared/constants/roles';

/**
 * Team members' employee IDs are now issued by the backend (LS0001, LS0002, … — see
 * formatEmployeeId in modules/auth/auth.constants.ts) instead of typed into the Add team member
 * form. The sequence only hands out the next number; the backend formats it. It starts above the
 * highest LSnnnn ID already typed in, so a generated ID never repeats one, and every active team
 * member without an ID gets one now.
 */
export class StaffEmployeeIds1795420000000 implements MigrationInterface {
  name = 'StaffEmployeeIds1795420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SEQUENCE "auth"."staff_employee_id_seq" START 1`);
    await queryRunner.query(`
      SELECT setval(
        '"auth"."staff_employee_id_seq"',
        GREATEST(
          COALESCE(
            (SELECT MAX(substring("employee_id" FROM 3)::bigint)
               FROM "auth"."users"
              WHERE "employee_id" ~ '^LS[0-9]{1,15}$'),
            0
          ),
          0
        ) + 1,
        false
      )`);
    await queryRunner.query(
      `UPDATE "auth"."users" u
          SET "employee_id" = 'LS' || lpad(nextval('"auth"."staff_employee_id_seq"')::text, 4, '0')
         FROM "auth"."roles" r
        WHERE r."id" = u."role_id"
          AND r."name" = ANY($1)
          AND u."employee_id" IS NULL
          AND u."deleted_at" IS NULL`,
      [STAFF_TEAMS],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // IDs handed out by up() stay — they're shown to ops and may already be in use.
    await queryRunner.query(`DROP SEQUENCE "auth"."staff_employee_id_seq"`);
  }
}
