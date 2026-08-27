import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds the delivery-receipt fields the E-POD screen actually collects alongside the receiver's
// name and quantity received: their mobile number (storage only — no notification infra exists
// yet to act on "we send them a copy"), designation, and the seal-on-arrival check (advisory
// only — no exceptions/escalations module exists yet to route a broken seal to; see
// loads/utils/loads.types.ts's SEAL_STATUSES doc comment).
export class AddPodDetailsToLoads1787800000000 implements MigrationInterface {
  name = 'AddPodDetailsToLoads1787800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "loads"."loads_seal_status_enum" AS ENUM('intact', 'broken')`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD "pod_receiver_mobile" character varying(10)`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD "pod_receiver_designation" character varying(150)`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD "seal_status" "loads"."loads_seal_status_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "seal_status"`);
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "pod_receiver_designation"`);
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "pod_receiver_mobile"`);
    await queryRunner.query(`DROP TYPE "loads"."loads_seal_status_enum"`);
  }
}
