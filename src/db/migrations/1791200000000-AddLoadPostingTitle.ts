import { MigrationInterface, QueryRunner } from 'typeorm';

// Post a load: an optional shipper-given title on the posting, copied onto each load it creates
// (shown in trip views, searchable in the load lists, and included in the transporter message).
export class AddLoadPostingTitle1791200000000 implements MigrationInterface {
  name = 'AddLoadPostingTitle1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."load_postings" ADD "title" character varying(100)`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."loads" ADD "title" character varying(100)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "title"`);
    await queryRunner.query(`ALTER TABLE "loads"."load_postings" DROP COLUMN "title"`);
  }
}
