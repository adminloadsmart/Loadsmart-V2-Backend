import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLoadingPointsTable1786604900000 implements MigrationInterface {
  name = 'CreateLoadingPointsTable1786604900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "masters"."loading_points_status_enum" AS ENUM('pending', 'active', 'inactive', 'rejected')`,
    );
    await queryRunner.query(
      `CREATE TABLE "masters"."loading_points" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "title" character varying(150) NOT NULL, "address_line_1" character varying(255) NOT NULL, "address_line_2" character varying(255), "landmark" character varying(255), "area_locality" character varying(255), "city" character varying(100) NOT NULL, "state" character varying(100) NOT NULL, "pin_code" character varying(10) NOT NULL, "latitude" numeric(10,6), "longitude" numeric(10,6), "contact_person_name" character varying(150), "contact_person_number" character varying(20), "contact_person_email" character varying(255), "status" "masters"."loading_points_status_enum" NOT NULL DEFAULT 'pending', "approved_by" uuid, "approved_at" TIMESTAMP WITH TIME ZONE, "rejection_reason" character varying, "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5b2d2d2ccf6f274fce0f0b62b12" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "loading_points_tenant_city_idx" ON "masters"."loading_points"  ("tenant_id", "city") `,
    );
    await queryRunner.query(
      `CREATE INDEX "loading_points_tenant_status_idx" ON "masters"."loading_points"  ("tenant_id", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "loading_points_tenant_id_idx" ON "masters"."loading_points"  ("tenant_id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "masters"."loading_points_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."loading_points_tenant_status_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."loading_points_tenant_city_idx"`);
    await queryRunner.query(`DROP TABLE "masters"."loading_points"`);
    await queryRunner.query(`DROP TYPE "masters"."loading_points_status_enum"`);
  }
}
