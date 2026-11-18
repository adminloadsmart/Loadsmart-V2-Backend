import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/** The e-way bill's real validity date, captured when it is uploaded (it replaces the 2-hour
 *  placeholder the expiry alert used). */
export class EwayBillExpiry1795350000000 implements MigrationInterface {
  name = 'EwayBillExpiry1795350000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'loads.loads',
      new TableColumn({ name: 'eway_bill_expires_at', type: 'timestamptz', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('loads.loads', 'eway_bill_expires_at');
  }
}
