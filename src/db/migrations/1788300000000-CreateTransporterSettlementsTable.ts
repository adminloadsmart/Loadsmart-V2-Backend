import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTransporterSettlementsTable1788300000000 implements MigrationInterface {
  name = 'CreateTransporterSettlementsTable1788300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "payments"."transporter_settlements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "load_id" uuid NOT NULL, "transporter_id" uuid NOT NULL, "amount" numeric(12,2) NOT NULL, "utr_reference" character varying(100) NOT NULL, "proof_file_key" text, "payment_date" date NOT NULL, "recorded_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_transporter_settlements_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "transporter_settlements_load_unique" ON "payments"."transporter_settlements"  ("load_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "transporter_settlements_tenant_transporter_idx" ON "payments"."transporter_settlements"  ("tenant_id", "transporter_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "payments"."transporter_settlements" ADD CONSTRAINT "FK_transporter_settlements_load_id" FOREIGN KEY ("load_id") REFERENCES "loads"."loads"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments"."transporter_settlements" ADD CONSTRAINT "FK_transporter_settlements_transporter_id" FOREIGN KEY ("transporter_id") REFERENCES "masters"."transporters"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments"."transporter_settlements" DROP CONSTRAINT "FK_transporter_settlements_transporter_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments"."transporter_settlements" DROP CONSTRAINT "FK_transporter_settlements_load_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "payments"."transporter_settlements_tenant_transporter_idx"`,
    );
    await queryRunner.query(`DROP INDEX "payments"."transporter_settlements_load_unique"`);
    await queryRunner.query(`DROP TABLE "payments"."transporter_settlements"`);
  }
}
