import { MigrationInterface, QueryRunner } from 'typeorm';

// Driver-app E-POD redesign: adds the 'wet' cargo-condition value and records when the receiver's
// code was verified. pod_receiver_mobile was already nullable (1787800000000).
export class AddPodReceiverVerification1790200000000 implements MigrationInterface {
  name = 'AddPodReceiverVerification1790200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "loads"."loads_shortage_or_damage_enum" ADD VALUE IF NOT EXISTS 'wet'`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD "pod_receiver_verified_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "pod_receiver_verified_at"`);
    // 'wet' stays on loads_shortage_or_damage_enum — Postgres can't drop an enum value, same as
    // every other migration here that's ever added one.
  }
}
