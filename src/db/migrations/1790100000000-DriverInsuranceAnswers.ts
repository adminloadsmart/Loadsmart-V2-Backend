import { MigrationInterface, QueryRunner } from 'typeorm';

// drivers.has_health_insurance / has_life_insurance: boolean -> yes | no | dont_know, to match the
// driver app's Insurance screen. Existing true -> 'yes', false -> 'no'; default stays "no".
export class DriverInsuranceAnswers1790100000000 implements MigrationInterface {
  name = 'DriverInsuranceAnswers1790100000000';

  private readonly columns = ['has_health_insurance', 'has_life_insurance'];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const column of this.columns) {
      const enumName = `drivers_${column}_enum`;
      await queryRunner.query(
        `CREATE TYPE "masters"."${enumName}" AS ENUM('yes', 'no', 'dont_know')`,
      );
      await queryRunner.query(
        `ALTER TABLE "masters"."drivers" ALTER COLUMN "${column}" DROP DEFAULT`,
      );
      await queryRunner.query(
        `ALTER TABLE "masters"."drivers" ALTER COLUMN "${column}" TYPE "masters"."${enumName}" USING (CASE WHEN "${column}" THEN 'yes' ELSE 'no' END)::"masters"."${enumName}"`,
      );
      await queryRunner.query(
        `ALTER TABLE "masters"."drivers" ALTER COLUMN "${column}" SET DEFAULT 'no'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of this.columns) {
      const enumName = `drivers_${column}_enum`;
      await queryRunner.query(
        `ALTER TABLE "masters"."drivers" ALTER COLUMN "${column}" DROP DEFAULT`,
      );
      await queryRunner.query(
        `ALTER TABLE "masters"."drivers" ALTER COLUMN "${column}" TYPE boolean USING ("${column}" = 'yes')`,
      );
      await queryRunner.query(
        `ALTER TABLE "masters"."drivers" ALTER COLUMN "${column}" SET DEFAULT false`,
      );
      await queryRunner.query(`DROP TYPE "masters"."${enumName}"`);
    }
  }
}
