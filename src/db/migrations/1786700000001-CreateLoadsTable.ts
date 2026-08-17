import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLoadsTable1786700000001 implements MigrationInterface {
  name = 'CreateLoadsTable1786700000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "loads"."loads_source_type_enum" AS ENUM('own_fleet', 'market')`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."loads_status_enum" AS ENUM('created', 'assigned', 'loading_confirmed', 'at_plant', 'in_transit', 'reached_delivery_point', 'delivered', 'closed')`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."loads_freight_type_enum" AS ENUM('per_ton', 'flat')`,
    );
    await queryRunner.query(
      `CREATE TABLE "loads"."loads" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "requisition_id" uuid NOT NULL, "source_type" "loads"."loads_source_type_enum" NOT NULL, "status" "loads"."loads_status_enum" NOT NULL DEFAULT 'created', "planned_capacity_tonnes" numeric(10,2) NOT NULL, "truck_type_id" uuid, "feet_wheels" character varying(50), "vehicle_id" uuid, "driver_id" uuid, "vehicle_number" character varying(20), "driver_number" character varying(20), "transporter_id" uuid, "freight_type" "loads"."loads_freight_type_enum", "freight_value" numeric(12,2), "advance_percentage" numeric(5,2), "balance_percentage" numeric(5,2), "invoice_number" character varying(50), "invoice_file_key" text, "eway_bill_number" character varying(50), "eway_bill_file_key" text, "eway_bill_generated_at" TIMESTAMP WITH TIME ZONE, "elr_number" character varying(50), "elr_file_key" text, "loading_confirmed_at" TIMESTAMP WITH TIME ZONE, "loading_confirmed_by" uuid, "at_plant_at" TIMESTAMP WITH TIME ZONE, "in_transit_at" TIMESTAMP WITH TIME ZONE, "reached_delivery_point_at" TIMESTAMP WITH TIME ZONE, "delivered_at" TIMESTAMP WITH TIME ZONE, "pod_file_key" text, "pod_receiver_name" character varying(150), "pod_quantity_received" numeric(10,2), "pod_remarks" character varying, "advance_paid_at" TIMESTAMP WITH TIME ZONE, "balance_paid_at" TIMESTAMP WITH TIME ZONE, "closed_at" TIMESTAMP WITH TIME ZONE, "created_by" uuid, "updated_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c90caf6ef671c1a292bc4b4bc1b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "loads_tenant_vehicle_idx" ON "loads"."loads"  ("tenant_id", "vehicle_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "loads_tenant_requisition_idx" ON "loads"."loads"  ("tenant_id", "requisition_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "loads_tenant_status_idx" ON "loads"."loads"  ("tenant_id", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "loads_tenant_id_idx" ON "loads"."loads"  ("tenant_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD CONSTRAINT "FK_bd658084b9bab12979b73f996e2" FOREIGN KEY ("requisition_id") REFERENCES "loads"."requisitions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD CONSTRAINT "FK_ff7a768b791a6b1f49e1dbcf51c" FOREIGN KEY ("truck_type_id") REFERENCES "masters"."truck_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD CONSTRAINT "FK_ae906bb968b341c144a8ece794a" FOREIGN KEY ("vehicle_id") REFERENCES "masters"."vehicles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD CONSTRAINT "FK_d32c6dc658ff1dab63f59753757" FOREIGN KEY ("driver_id") REFERENCES "masters"."drivers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD CONSTRAINT "FK_1055388470a671479737f8404df" FOREIGN KEY ("transporter_id") REFERENCES "masters"."transporters"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" DROP CONSTRAINT "FK_1055388470a671479737f8404df"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" DROP CONSTRAINT "FK_d32c6dc658ff1dab63f59753757"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" DROP CONSTRAINT "FK_ae906bb968b341c144a8ece794a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" DROP CONSTRAINT "FK_ff7a768b791a6b1f49e1dbcf51c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" DROP CONSTRAINT "FK_bd658084b9bab12979b73f996e2"`,
    );
    await queryRunner.query(`DROP INDEX "loads"."loads_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "loads"."loads_tenant_status_idx"`);
    await queryRunner.query(`DROP INDEX "loads"."loads_tenant_requisition_idx"`);
    await queryRunner.query(`DROP INDEX "loads"."loads_tenant_vehicle_idx"`);
    await queryRunner.query(`DROP TABLE "loads"."loads"`);
    await queryRunner.query(`DROP TYPE "loads"."loads_freight_type_enum"`);
    await queryRunner.query(`DROP TYPE "loads"."loads_status_enum"`);
    await queryRunner.query(`DROP TYPE "loads"."loads_source_type_enum"`);
  }
}
