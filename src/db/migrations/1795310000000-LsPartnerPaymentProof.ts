import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/** A carrier payment can carry the payment advice Payables uploads, not just the UTR. */
export class LsPartnerPaymentProof1795310000000 implements MigrationInterface {
  name = 'LsPartnerPaymentProof1795310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'loads.ls_partner_payments',
      new TableColumn({ name: 'proof_file_key', type: 'varchar', length: '500', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('loads.ls_partner_payments', 'proof_file_key');
  }
}
