import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Older synchronize-created transporter tables made optional detail fields
 * required. Keep the database contract aligned with TransporterEntity and the
 * create validator, where only name and phone are mandatory.
 */
export class MakeTransporterOptionalFieldsNullable1786787100000 implements MigrationInterface {
  name = 'MakeTransporterOptionalFieldsNullable1786787100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "masters"."transporters"
        ALTER COLUMN "rate" DROP NOT NULL,
        ALTER COLUMN "email" DROP NOT NULL,
        ALTER COLUMN "gstin" DROP NOT NULL,
        ALTER COLUMN "msme_registration" DROP NOT NULL,
        ALTER COLUMN "company_type" DROP NOT NULL,
        ALTER COLUMN "advance_percentage" DROP NOT NULL,
        ALTER COLUMN "credit_days" DROP NOT NULL,
        ALTER COLUMN "address_line_1" DROP NOT NULL,
        ALTER COLUMN "address_line_2" DROP NOT NULL,
        ALTER COLUMN "landmark" DROP NOT NULL,
        ALTER COLUMN "area_locality" DROP NOT NULL,
        ALTER COLUMN "city" DROP NOT NULL,
        ALTER COLUMN "state" DROP NOT NULL,
        ALTER COLUMN "pin_code" DROP NOT NULL,
        ALTER COLUMN "bank_account_number" DROP NOT NULL,
        ALTER COLUMN "bank_ifsc" DROP NOT NULL,
        ALTER COLUMN "bank_account_holder_name" DROP NOT NULL,
        ALTER COLUMN "created_by" DROP NOT NULL,
        ALTER COLUMN "updated_by" DROP NOT NULL
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // NULL values cannot be safely converted back to required fields.
  }
}
