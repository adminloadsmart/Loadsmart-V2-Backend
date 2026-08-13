import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStorageFilesTable1786604851103 implements MigrationInterface {
  name = 'CreateStorageFilesTable1786604851103';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Same reasoning as InitialSchema.ts's own CREATE SCHEMA calls: TypeORM's migration-generate
    // never emits this itself, and storage.files has had no committed migration at all until now
    // (it only ever existed locally via dev-mode synchronize) — a genuinely fresh DB needs the
    // schema created explicitly, first.
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "storage"`);
    await queryRunner.query(
      `CREATE TYPE "storage"."files_purpose_enum" AS ENUM('kyc', 'trips/pod', 'trips/lr', 'masters/vehicle', 'profile')`,
    );
    await queryRunner.query(
      `CREATE TYPE "storage"."files_status_enum" AS ENUM('pending', 'confirmed', 'failed')`,
    );
    await queryRunner.query(
      // tenant_id is nullable: a platform-scope caller or a pre-org-creation org_admin has no
      // tenant of its own — see file.entity.ts.
      `CREATE TABLE "storage"."files" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid, "uploaded_by" uuid NOT NULL, "purpose" "storage"."files_purpose_enum" NOT NULL, "key" text NOT NULL, "original_file_name" character varying(255) NOT NULL, "mime_type" character varying(255) NOT NULL, "size_bytes" integer NOT NULL, "status" "storage"."files_status_enum" NOT NULL DEFAULT 'pending', "confirmed_at" TIMESTAMP WITH TIME ZONE, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6c16b9093a142e0e7613b04a3d9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "files_key_idx" ON "storage"."files" ("key")`);
    await queryRunner.query(
      `CREATE INDEX "files_status_created_at_idx" ON "storage"."files" ("status", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "files_tenant_id_idx" ON "storage"."files" ("tenant_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "storage"."files_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "storage"."files_status_created_at_idx"`);
    await queryRunner.query(`DROP INDEX "storage"."files_key_idx"`);
    await queryRunner.query(`DROP TABLE "storage"."files"`);
    await queryRunner.query(`DROP TYPE "storage"."files_status_enum"`);
    await queryRunner.query(`DROP TYPE "storage"."files_purpose_enum"`);
  }
}
