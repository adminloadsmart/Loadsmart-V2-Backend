import { MigrationInterface, QueryRunner } from 'typeorm';

// Settings → Masters → Contracts: a transporter's agreed rate, billing unit, validity, P-ranking
// and share of business on one lane. Standalone — loads.customer_contracts (Post a load Indent)
// is untouched.
export class CreateTransporterContracts1792000000000 implements MigrationInterface {
  name = 'CreateTransporterContracts1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "masters"."transporter_contracts_billing_unit_enum" AS ENUM('per_ton', 'per_truck')`,
    );
    await queryRunner.query(`
      CREATE TABLE "masters"."transporter_contracts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "transporter_id" uuid NOT NULL,
        "source_city" character varying(100) NOT NULL,
        "source_state" character varying(100) NOT NULL,
        "destination_city" character varying(100) NOT NULL,
        "destination_state" character varying(100) NOT NULL,
        "agreed_rate" numeric(12,2) NOT NULL,
        "billing_unit" "masters"."transporter_contracts_billing_unit_enum" NOT NULL,
        "valid_from" date NOT NULL,
        "valid_to" date NOT NULL,
        "priority" smallint NOT NULL,
        "share_percentage" numeric(5,2),
        "notes" text,
        "created_by" uuid,
        "updated_by" uuid,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_transporter_contracts_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_transporter_contracts_validity" CHECK ("valid_to" >= "valid_from"),
        CONSTRAINT "FK_transporter_contracts_transporter" FOREIGN KEY ("transporter_id") REFERENCES "masters"."transporters"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "transporter_contracts_tenant_idx" ON "masters"."transporter_contracts" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "transporter_contracts_tenant_transporter_idx" ON "masters"."transporter_contracts" ("tenant_id", "transporter_id")`,
    );
    // Lane lookups (overlap checks, lane allocation) match case-insensitively on trimmed cities.
    await queryRunner.query(
      `CREATE INDEX "transporter_contracts_tenant_lane_idx" ON "masters"."transporter_contracts" ("tenant_id", LOWER(TRIM("source_city")), LOWER(TRIM("destination_city"))) WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "masters"."transporter_contracts_tenant_lane_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."transporter_contracts_tenant_transporter_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."transporter_contracts_tenant_idx"`);
    await queryRunner.query(`DROP TABLE "masters"."transporter_contracts"`);
    await queryRunner.query(`DROP TYPE "masters"."transporter_contracts_billing_unit_enum"`);
  }
}
