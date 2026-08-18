import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillShopboardPremisesDocuments1787000002000 implements MigrationInterface {
  name = 'BackfillShopboardPremisesDocuments1787000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "auth"."organization_documents"
        ("organization_id", "document_type", "file_key", "verification_status")
      SELECT
        o."id",
        'shopboard_premises_photo',
        o."shopboard_premises_photo_key",
        'pending'
      FROM "auth"."organizations" o
      WHERE o."shopboard_premises_photo_key" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "auth"."organization_documents" d
          WHERE d."organization_id" = o."id"
            AND d."document_type" = 'shopboard_premises_photo'
            AND d."deleted_at" IS NULL
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "auth"."organization_documents" d
      USING "auth"."organizations" o
      WHERE d."organization_id" = o."id"
        AND d."document_type" = 'shopboard_premises_photo'
        AND d."file_key" = o."shopboard_premises_photo_key"
    `);
  }
}
