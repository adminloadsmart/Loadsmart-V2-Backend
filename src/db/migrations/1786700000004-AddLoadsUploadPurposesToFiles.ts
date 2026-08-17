import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * storage.files.purpose is a Postgres enum backing storage.constants.ts's UPLOAD_PURPOSES (see
 * FileEntity) — adding a new purpose there requires a matching ALTER TYPE here, it isn't just
 * app-level config. Adds the 3 purposes the Loads module's document uploads use (PRD §6.5/§6.6);
 * `trips/pod`/`trips/lr` are reused as-is for E-POD/E-LR and need no change.
 */
export class AddLoadsUploadPurposesToFiles1786700000004 implements MigrationInterface {
  name = 'AddLoadsUploadPurposesToFiles1786700000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "storage"."files_purpose_enum" ADD VALUE 'loads/invoice'`);
    await queryRunner.query(
      `ALTER TYPE "storage"."files_purpose_enum" ADD VALUE 'loads/eway-bill'`,
    );
    await queryRunner.query(
      `ALTER TYPE "storage"."files_purpose_enum" ADD VALUE 'loads/payment-proof'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres has no DROP VALUE for enums — rebuild the type without the 3 added values, same
    // "create _old, swap column over, drop, rename back" dance TypeORM itself generates whenever
    // an enum's value set is edited (see any migration:generate diff that narrows an enum).
    await queryRunner.query(
      `CREATE TYPE "storage"."files_purpose_enum_old" AS ENUM('kyc', 'trips/pod', 'trips/lr', 'masters/vehicle', 'profile')`,
    );
    await queryRunner.query(
      `ALTER TABLE "storage"."files" ALTER COLUMN "purpose" TYPE "storage"."files_purpose_enum_old" USING "purpose"::"text"::"storage"."files_purpose_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "storage"."files_purpose_enum"`);
    await queryRunner.query(
      `ALTER TYPE "storage"."files_purpose_enum_old" RENAME TO "files_purpose_enum"`,
    );
  }
}
