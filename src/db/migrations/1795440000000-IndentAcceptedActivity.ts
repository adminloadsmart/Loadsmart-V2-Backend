import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Transporter accepted": the shipper records an indent transporter's acceptance given by phone,
 * before the truck number is in — a load activity of its own.
 */
export class IndentAcceptedActivity1795440000000 implements MigrationInterface {
  name = 'IndentAcceptedActivity1795440000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "loads"."load_activities_action_enum" ADD VALUE IF NOT EXISTS 'INDENT_ACCEPTED'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres can't drop an enum value; an unused one is harmless.
  }
}
