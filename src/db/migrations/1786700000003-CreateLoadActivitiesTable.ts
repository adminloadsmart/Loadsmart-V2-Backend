import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLoadActivitiesTable1786700000003 implements MigrationInterface {
  name = 'CreateLoadActivitiesTable1786700000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "loads"."load_activities_action_enum" AS ENUM('LOAD_CREATED', 'STATUS_CHANGED', 'DOCUMENT_UPLOADED', 'PAYMENT_RECORDED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "loads"."load_activities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "load_id" uuid NOT NULL, "actor_id" uuid, "action" "loads"."load_activities_action_enum" NOT NULL, "from_value" character varying(100), "to_value" character varying(100), "metadata" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a9d1cf3579f0f03126b70ff8fc5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "load_activities_load_created_idx" ON "loads"."load_activities"  ("load_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "load_activities_tenant_id_idx" ON "loads"."load_activities"  ("tenant_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_activities" ADD CONSTRAINT "FK_3ea4f286c986c562579d8442546" FOREIGN KEY ("load_id") REFERENCES "loads"."loads"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."load_activities" DROP CONSTRAINT "FK_3ea4f286c986c562579d8442546"`,
    );
    await queryRunner.query(`DROP INDEX "loads"."load_activities_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "loads"."load_activities_load_created_idx"`);
    await queryRunner.query(`DROP TABLE "loads"."load_activities"`);
    await queryRunner.query(`DROP TYPE "loads"."load_activities_action_enum"`);
  }
}
