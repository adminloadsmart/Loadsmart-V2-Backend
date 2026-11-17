import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Load module Phase 3 (own fleet, and every route):
 * - Unloading details: a warehouse appointment (ID, date, slot) beside the existing receiver
 *   name/mobile, and who added them when.
 * - The stamped invoice, optional with the POD, in the documents register.
 */
export class LoadUnloadingDetails1794600000000 implements MigrationInterface {
  name = 'LoadUnloadingDetails1794600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "loads"."load_activities_action_enum" ADD VALUE IF NOT EXISTS 'UNLOADING_DETAILS_SAVED'`,
    );
    await queryRunner.query(
      `ALTER TYPE "loads"."load_documents_doc_type_enum" ADD VALUE IF NOT EXISTS 'stamped_invoice' AFTER 'pod_back'`,
    );
    await queryRunner.query(`
      ALTER TABLE "loads"."loads"
        ADD "unloading_appointment_id" character varying(60),
        ADD "unloading_appointment_date" date,
        ADD "unloading_appointment_slot" character varying(40),
        ADD "unloading_details_added_by" uuid,
        ADD "unloading_details_added_at" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The enum values stay — PostgreSQL can't drop them, and code without them never writes them.
    await queryRunner.query(`
      ALTER TABLE "loads"."loads"
        DROP COLUMN "unloading_details_added_at",
        DROP COLUMN "unloading_details_added_by",
        DROP COLUMN "unloading_appointment_slot",
        DROP COLUMN "unloading_appointment_date",
        DROP COLUMN "unloading_appointment_id"`);
  }
}
