import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDriverProfileFields1786700772148 implements MigrationInterface {
  name = 'AddDriverProfileFields1786700772148';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_documents" ADD "document_number" character varying(50)`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."drivers_blood_group_enum" AS ENUM('A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-')`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD "blood_group" "masters"."drivers_blood_group_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD "address_line1" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD "address_line2" character varying(255)`,
    );
    await queryRunner.query(`ALTER TABLE "masters"."drivers" ADD "city" character varying(100)`);
    await queryRunner.query(`ALTER TABLE "masters"."drivers" ADD "pin_code" character varying(6)`);
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD "emergency_contact_name" character varying(150)`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD "emergency_contact_phone" character varying(15)`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."drivers_salary_type_enum" AS ENUM('fixed', 'per_trip', 'per_km')`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD "salary_type" "masters"."drivers_salary_type_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "masters"."drivers" ADD "salary_amount" numeric(12,2)`);
    await queryRunner.query(
      `ALTER TYPE "masters"."driver_documents_document_type_enum" ADD VALUE 'aadhaar'`,
    );
    await queryRunner.query(
      `ALTER TYPE "masters"."driver_documents_document_type_enum" ADD VALUE 'pan'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "masters"."driver_documents_document_type_enum_old" AS ENUM('driving_license_front', 'driving_license_back')`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_documents" ALTER COLUMN "document_type" TYPE "masters"."driver_documents_document_type_enum_old" USING "document_type"::"text"::"masters"."driver_documents_document_type_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "masters"."driver_documents_document_type_enum"`);
    await queryRunner.query(
      `ALTER TYPE "masters"."driver_documents_document_type_enum_old" RENAME TO "driver_documents_document_type_enum"`,
    );
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "salary_amount"`);
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "salary_type"`);
    await queryRunner.query(`DROP TYPE "masters"."drivers_salary_type_enum"`);
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" DROP COLUMN "emergency_contact_phone"`,
    );
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "emergency_contact_name"`);
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "pin_code"`);
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "city"`);
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "address_line2"`);
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "address_line1"`);
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "blood_group"`);
    await queryRunner.query(`DROP TYPE "masters"."drivers_blood_group_enum"`);
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_documents" DROP COLUMN "document_number"`,
    );
  }
}
