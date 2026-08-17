import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLoadPaymentsTable1786700000002 implements MigrationInterface {
  name = 'CreateLoadPaymentsTable1786700000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "loads"."load_payments_payment_type_enum" AS ENUM('advance', 'balance')`,
    );
    await queryRunner.query(
      `CREATE TABLE "loads"."load_payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "load_id" uuid NOT NULL, "transporter_id" uuid, "payment_type" "loads"."load_payments_payment_type_enum" NOT NULL, "amount" numeric(12,2) NOT NULL, "utr_reference" character varying(100) NOT NULL, "proof_file_key" text, "payment_date" date NOT NULL, "due_date" date, "recorded_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_05bbb5a8e535999a046af38983c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "load_payments_load_type_unique" ON "loads"."load_payments"  ("load_id", "payment_type") `,
    );
    await queryRunner.query(
      `CREATE INDEX "load_payments_tenant_transporter_idx" ON "loads"."load_payments"  ("tenant_id", "transporter_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "load_payments_tenant_load_idx" ON "loads"."load_payments"  ("tenant_id", "load_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_payments" ADD CONSTRAINT "FK_14a7f32d53b6bf5f4066f1cb6a0" FOREIGN KEY ("load_id") REFERENCES "loads"."loads"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_payments" ADD CONSTRAINT "FK_2ec7957bd316298198e8c0a85f3" FOREIGN KEY ("transporter_id") REFERENCES "masters"."transporters"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."load_payments" DROP CONSTRAINT "FK_2ec7957bd316298198e8c0a85f3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_payments" DROP CONSTRAINT "FK_14a7f32d53b6bf5f4066f1cb6a0"`,
    );
    await queryRunner.query(`DROP INDEX "loads"."load_payments_tenant_load_idx"`);
    await queryRunner.query(`DROP INDEX "loads"."load_payments_tenant_transporter_idx"`);
    await queryRunner.query(`DROP INDEX "loads"."load_payments_load_type_unique"`);
    await queryRunner.query(`DROP TABLE "loads"."load_payments"`);
    await queryRunner.query(`DROP TYPE "loads"."load_payments_payment_type_enum"`);
  }
}
