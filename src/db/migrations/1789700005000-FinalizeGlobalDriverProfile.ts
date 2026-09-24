import { MigrationInterface, QueryRunner } from 'typeorm';

// Final cutover: makes masters.drivers genuinely tenant-independent, and makes the relation-id
// columns added earlier the real (NOT NULL, FK'd) references they were always meant to become.
export class FinalizeGlobalDriverProfile1789700005000 implements MigrationInterface {
  name = 'FinalizeGlobalDriverProfile1789700005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- driver_operational_statuses: driver_id -> driver_tenant_relation_id ---
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_operational_statuses" DROP CONSTRAINT "FK_d8b7281f96a0e85d5c88682fe3d"`,
    );
    await queryRunner.query(`DROP INDEX "masters"."driver_operational_statuses_driver_id_unique"`);
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_operational_statuses" DROP CONSTRAINT "REL_d8b7281f96a0e85d5c88682fe3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_operational_statuses" DROP COLUMN "driver_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_operational_statuses" ALTER COLUMN "driver_tenant_relation_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "driver_operational_statuses_relation_id_unique" ON "masters"."driver_operational_statuses" ("driver_tenant_relation_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_operational_statuses" ADD CONSTRAINT "FK_driver_operational_statuses_relation_id" FOREIGN KEY ("driver_tenant_relation_id") REFERENCES "masters"."driver_tenant_relations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // --- driver_trip_metrics: driver_id -> driver_tenant_relation_id ---
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_trip_metrics" DROP CONSTRAINT "FK_a4a10eb593b745406360e5954d0"`,
    );
    await queryRunner.query(`DROP INDEX "masters"."driver_trip_metrics_driver_period_unique"`);
    await queryRunner.query(`DROP INDEX "masters"."driver_trip_metrics_driver_id_idx"`);
    await queryRunner.query(`ALTER TABLE "masters"."driver_trip_metrics" DROP COLUMN "driver_id"`);
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_trip_metrics" ALTER COLUMN "driver_tenant_relation_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "driver_trip_metrics_relation_id_idx" ON "masters"."driver_trip_metrics" ("driver_tenant_relation_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "driver_trip_metrics_relation_period_unique" ON "masters"."driver_trip_metrics" ("tenant_id", "driver_tenant_relation_id", "period_start", "period_end") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_trip_metrics" ADD CONSTRAINT "FK_driver_trip_metrics_relation_id" FOREIGN KEY ("driver_tenant_relation_id") REFERENCES "masters"."driver_tenant_relations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // --- fleet_driver_links: driver_tenant_relation_id becomes required ---
    await queryRunner.query(
      `ALTER TABLE "masters"."fleet_driver_links" ALTER COLUMN "driver_tenant_relation_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "fleet_driver_links_relation_id_idx" ON "masters"."fleet_driver_links" ("driver_tenant_relation_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."fleet_driver_links" ADD CONSTRAINT "FK_fleet_driver_links_relation_id" FOREIGN KEY ("driver_tenant_relation_id") REFERENCES "masters"."driver_tenant_relations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // --- drivers: drop everything now owned by driver_tenant_relations, add the new profile
    // fields. date_of_joining/salary_type/salary_amount are NOT dropped — they stay right where
    // they are; only the approval-workflow fields move to the relation. ---
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "tenant_id"`);
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "status"`);
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "approved_by"`);
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "approved_at"`);
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "rejection_reason"`);
    await queryRunner.query(`DROP TYPE "masters"."drivers_status_enum"`);

    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD "has_health_insurance" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD "has_life_insurance" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD "emergency_contact_relation" character varying(50)`,
    );

    // Self-registration's 3-screen wizard progress — a resume-position bookmark, not a computed
    // business rule: screens 2/3's own fields are all optional, so "has screen 2 been completed"
    // can't be inferred from data presence alone (the driver could tap Continue with nothing
    // filled in). The client reports its own progress on each /register call instead.
    await queryRunner.query(
      `CREATE TYPE "masters"."drivers_onboarding_step_enum" AS ENUM('identity_verification', 'emergency_information', 'bank_details', 'completed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD "onboarding_step" "masters"."drivers_onboarding_step_enum"`,
    );

    await queryRunner.query(
      `CREATE TYPE "masters"."drivers_registration_source_enum" AS ENUM('self', 'staff_created')`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD "registration_source" "masters"."drivers_registration_source_enum" NOT NULL DEFAULT 'staff_created'`,
    );

    // Neither phone nor licence number is made globally unique: both were only unique per tenant
    // on the old tenant-scoped table, so either can legitimately collide across rows in the
    // existing data. App-layer lookups (findByPhoneNumber/findByLicenseNumber in
    // driver.service.ts / driver-identity.service.ts) already prevent a new duplicate from being
    // created going forward, without requiring every existing row to be reconciled first here.
    // Plain indexes for lookup performance only.
    await queryRunner.query(
      `CREATE INDEX "drivers_phone_number_idx" ON "masters"."drivers" ("phone_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "drivers_license_number_idx" ON "masters"."drivers" ("license_number")`,
    );

    // --- driver_bank_details: UPI id, screen 3's other payout option alongside account/IFSC ---
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_bank_details" ADD "upi_id" character varying(50)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "masters"."driver_bank_details" DROP COLUMN "upi_id"`);
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" DROP COLUMN "emergency_contact_relation"`,
    );
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "has_insurance"`);
    await queryRunner.query(`DROP INDEX "masters"."drivers_license_number_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."drivers_phone_number_idx"`);
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "registration_source"`);
    await queryRunner.query(`DROP TYPE "masters"."drivers_registration_source_enum"`);

    await queryRunner.query(
      `CREATE TYPE "masters"."drivers_status_enum" AS ENUM('active', 'inactive', 'on_trip', 'on_leave', 'pending', 'rejected')`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD "rejection_reason" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD "approved_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "masters"."drivers" ADD "approved_by" uuid`);
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD "status" "masters"."drivers_status_enum" NOT NULL DEFAULT 'active'`,
    );
    // date_of_joining/salary_type/salary_amount were never dropped by up() — nothing to restore.
    // A single tenant_id can't be reconstructed for a driver linked to more than one tenant —
    // this down() restores column shape only, not per-tenant rows. Once any driver has acquired a
    // second tenant relation, this migration set should be treated as a one-way door.
    await queryRunner.query(`ALTER TABLE "masters"."drivers" ADD "tenant_id" uuid`);

    await queryRunner.query(
      `ALTER TABLE "masters"."fleet_driver_links" DROP CONSTRAINT "FK_fleet_driver_links_relation_id"`,
    );
    await queryRunner.query(`DROP INDEX "masters"."fleet_driver_links_relation_id_idx"`);
    await queryRunner.query(
      `ALTER TABLE "masters"."fleet_driver_links" ALTER COLUMN "driver_tenant_relation_id" DROP NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "masters"."driver_trip_metrics" DROP CONSTRAINT "FK_driver_trip_metrics_relation_id"`,
    );
    await queryRunner.query(`DROP INDEX "masters"."driver_trip_metrics_relation_period_unique"`);
    await queryRunner.query(`DROP INDEX "masters"."driver_trip_metrics_relation_id_idx"`);
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_trip_metrics" ALTER COLUMN "driver_tenant_relation_id" DROP NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "masters"."driver_trip_metrics" ADD "driver_id" uuid`);
    await queryRunner.query(
      `CREATE INDEX "driver_trip_metrics_driver_id_idx" ON "masters"."driver_trip_metrics" ("driver_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "driver_trip_metrics_driver_period_unique" ON "masters"."driver_trip_metrics" ("tenant_id", "driver_id", "period_start", "period_end") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_trip_metrics" ADD CONSTRAINT "FK_a4a10eb593b745406360e5954d0" FOREIGN KEY ("driver_id") REFERENCES "masters"."drivers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "masters"."driver_operational_statuses" DROP CONSTRAINT "FK_driver_operational_statuses_relation_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "masters"."driver_operational_statuses_relation_id_unique"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_operational_statuses" ALTER COLUMN "driver_tenant_relation_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_operational_statuses" ADD "driver_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_operational_statuses" ADD CONSTRAINT "REL_d8b7281f96a0e85d5c88682fe3" UNIQUE ("driver_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "driver_operational_statuses_driver_id_unique" ON "masters"."driver_operational_statuses" ("driver_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_operational_statuses" ADD CONSTRAINT "FK_d8b7281f96a0e85d5c88682fe3d" FOREIGN KEY ("driver_id") REFERENCES "masters"."drivers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }
}
