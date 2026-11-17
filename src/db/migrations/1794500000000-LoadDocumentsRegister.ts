import { MigrationInterface, QueryRunner } from 'typeorm';

/** [docType, load column, number column] for the single-file columns on loads. */
const LOAD_COLUMNS: [string, string, string | null][] = [
  ['invoice', 'invoice_file_key', 'invoice_number'],
  ['eway_bill', 'eway_bill_file_key', 'eway_bill_number'],
  ['signed_lr', 'elr_file_key', 'elr_number'],
  ['elr', 'elr_document_file_key', 'elr_number'],
  ['weighing_slip', 'weighing_slip_file_key', null],
  ['pod_front', 'pod_file_key', null],
  ['pod_back', 'pod_back_file_key', null],
  ['damage_photo', 'damage_photo_key', null],
  ['transporter_invoice', 'transporter_invoice_file_key', 'transporter_invoice_number'],
];
/** The driver's papers Placement collected on a Loadsmart load (ls_sourcings). */
const SOURCING_COLUMNS: [string, string][] = [
  ['driver_licence_front', 'licence_front_file_key'],
  ['driver_licence_back', 'licence_back_file_key'],
  ['rc_copy', 'rc_copy_file_key'],
];

const LOADSMART = `(l."route" = 'loadsmart' OR l."awarded_party" = 'loadsmart')`;
const LOADSMART_REVIEWED = `('invoice', 'eway_bill', 'signed_lr', 'loading_photo', 'weighing_slip', 'driver_licence_front', 'driver_licence_back', 'rc_copy')`;

/** The backfilled file's review status, as the load stands today: the POD's follow pod_status; a
 *  Loadsmart load's papers are approved once its papers were approved; the rest need nobody. */
const reviewStatusSql = (docType: string) => `(CASE
  WHEN '${docType}' IN ('pod_front', 'pod_back', 'damage_photo') THEN
    CASE l."pod_status"::text WHEN 'accepted' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'pending' END
  WHEN ${LOADSMART} AND '${docType}' IN ${LOADSMART_REVIEWED} THEN
    CASE WHEN l."ls_papers_approved_at" IS NOT NULL THEN 'approved' ELSE 'pending' END
  ELSE 'not_required' END)::"loads"."load_documents_review_status_enum"`;

/**
 * Load module Phase 2 — the documents register, loads.load_documents. Every file a load has
 * carried, versioned per type; a re-upload supersedes the current version instead of overwriting
 * it. The load's file columns stay as pointers to each type's current file. Backfilled as
 * version 1 (source 'backfill') from the files the loads hold today.
 */
export class LoadDocumentsRegister1794500000000 implements MigrationInterface {
  name = 'LoadDocumentsRegister1794500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "loads"."load_activities_action_enum" ADD VALUE IF NOT EXISTS 'DOCUMENT_REVIEWED'`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."load_documents_doc_type_enum" AS ENUM('invoice', 'eway_bill', 'signed_lr', 'elr', 'loading_photo', 'weighing_slip', 'pod_front', 'pod_back', 'damage_photo', 'transporter_invoice', 'driver_licence_front', 'driver_licence_back', 'rc_copy')`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."load_documents_source_enum" AS ENUM('web', 'driver_app', 'console', 'whatsapp', 'system', 'backfill')`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."load_documents_review_status_enum" AS ENUM('not_required', 'pending', 'approved', 'rejected')`,
    );
    await queryRunner.query(`
      CREATE TABLE "loads"."load_documents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "load_id" uuid NOT NULL,
        "doc_type" "loads"."load_documents_doc_type_enum" NOT NULL,
        "file_key" text NOT NULL,
        "version" integer NOT NULL,
        "supersedes_id" uuid,
        "superseded_at" TIMESTAMP WITH TIME ZONE,
        "source" "loads"."load_documents_source_enum" NOT NULL,
        "uploaded_by" uuid,
        "uploaded_by_driver_id" uuid,
        "review_status" "loads"."load_documents_review_status_enum" NOT NULL,
        "rejection_reason" text,
        "reviewed_by" uuid,
        "reviewed_at" TIMESTAMP WITH TIME ZONE,
        "extracted" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_load_documents" PRIMARY KEY ("id"),
        CONSTRAINT "FK_load_documents_load" FOREIGN KEY ("load_id")
          REFERENCES "loads"."loads"("id") ON DELETE RESTRICT
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "load_documents_load_type_idx" ON "loads"."load_documents" ("load_id", "doc_type", "version")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "load_documents_one_current_per_type" ON "loads"."load_documents" ("load_id", "doc_type") WHERE "superseded_at" IS NULL AND "doc_type" <> 'loading_photo'`,
    );
    await queryRunner.query(
      `CREATE INDEX "load_documents_tenant_review_idx" ON "loads"."load_documents" ("tenant_id", "review_status")`,
    );

    for (const [docType, column, numberColumn] of LOAD_COLUMNS) {
      await queryRunner.query(`
        INSERT INTO "loads"."load_documents"
          ("tenant_id", "load_id", "doc_type", "file_key", "version", "source", "uploaded_by",
           "review_status", "extracted", "created_at")
        SELECT l."tenant_id", l."id", '${docType}', l."${column}", 1, 'backfill', l."updated_by",
               ${reviewStatusSql(docType)},
               ${numberColumn ? `CASE WHEN l."${numberColumn}" IS NULL THEN NULL ELSE jsonb_build_object('number', l."${numberColumn}") END` : 'NULL'},
               l."updated_at"
          FROM "loads"."loads" l
         WHERE l."${column}" IS NOT NULL`);
    }
    await queryRunner.query(`
      INSERT INTO "loads"."load_documents"
        ("tenant_id", "load_id", "doc_type", "file_key", "version", "source", "uploaded_by",
         "review_status", "created_at")
      SELECT l."tenant_id", l."id", 'loading_photo', photo.key, photo.position::int, 'backfill',
             l."updated_by", ${reviewStatusSql('loading_photo')}, l."updated_at"
        FROM "loads"."loads" l,
             unnest(l."loading_photo_file_keys") WITH ORDINALITY AS photo(key, position)`);
    for (const [docType, column] of SOURCING_COLUMNS) {
      await queryRunner.query(`
        INSERT INTO "loads"."load_documents"
          ("tenant_id", "load_id", "doc_type", "file_key", "version", "source", "review_status",
           "created_at")
        SELECT l."tenant_id", l."id", '${docType}', s."${column}", 1, 'backfill',
               ${reviewStatusSql(docType)}, s."updated_at"
          FROM "loads"."ls_sourcings" s
          JOIN "loads"."loads" l ON l."id" = s."load_id"
         WHERE s."${column}" IS NOT NULL`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The load columns still hold every current file, so nothing is lost but the history.
    await queryRunner.query(`DROP TABLE "loads"."load_documents"`);
    await queryRunner.query(`DROP TYPE "loads"."load_documents_review_status_enum"`);
    await queryRunner.query(`DROP TYPE "loads"."load_documents_source_enum"`);
    await queryRunner.query(`DROP TYPE "loads"."load_documents_doc_type_enum"`);
  }
}
