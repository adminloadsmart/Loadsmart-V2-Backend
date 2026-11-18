import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/** The shipper's operations terms the Approval team keeps beyond the advance % and the balance
 *  payer: the days the advance is due within, and whether the shipper needs a physical LR. */
export class ShipperTermsOperations1795390000000 implements MigrationInterface {
  name = 'ShipperTermsOperations1795390000000';

  private readonly columns = [
    new TableColumn({ name: 'shipper_advance_days', type: 'integer', isNullable: true }),
    new TableColumn({ name: 'physical_lr', type: 'boolean', default: false }),
    new TableColumn({ name: 'physical_lr_note', type: 'text', isNullable: true }),
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('loads.ls_commercial_terms', this.columns);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumns('loads.ls_commercial_terms', this.columns);
  }
}
