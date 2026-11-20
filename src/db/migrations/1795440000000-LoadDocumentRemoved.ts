import { MigrationInterface, QueryRunner } from 'typeorm';

/** The load page lets the shipper delete an uploaded invoice / e-way bill / LR (to upload the
 *  right one) — noted on the load's timeline as DOCUMENT_REMOVED. */
export class LoadDocumentRemoved1795440000000 implements MigrationInterface {
  name = 'LoadDocumentRemoved1795440000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "loads"."load_activities_action_enum" ADD VALUE IF NOT EXISTS 'DOCUMENT_REMOVED'`,
    );
  }

  public async down(): Promise<void> {
    // The enum value stays — PostgreSQL can't drop it, and code without it never writes it.
  }
}
