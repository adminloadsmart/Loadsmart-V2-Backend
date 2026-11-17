import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/** Charges Tracking raises are approved by the shipper first, then Super Admin: a `pending_admin`
 *  status, Super Admin's decision columns, and the carrier advance a charge was sent with. */
export class ChargeSecondApproval1795320000000 implements MigrationInterface {
  name = 'ChargeSecondApproval1795320000000';

  private async setStatuses(queryRunner: QueryRunner, values: string[]): Promise<void> {
    const table = await queryRunner.getTable('loads.load_charges');
    const column = table!.findColumnByName('status')!;
    const next = column.clone();
    next.enum = values;
    await queryRunner.changeColumn(table!, column, next);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.setStatuses(queryRunner, [
      'raised',
      'queried',
      'pending_admin',
      'approved',
      'rejected',
    ]);
    await queryRunner.addColumns('loads.load_charges', [
      new TableColumn({ name: 'admin_decided_by', type: 'uuid', isNullable: true }),
      new TableColumn({ name: 'admin_decided_at', type: 'timestamptz', isNullable: true }),
      new TableColumn({ name: 'partner_payment_id', type: 'uuid', isNullable: true }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumns('loads.load_charges', [
      'admin_decided_by',
      'admin_decided_at',
      'partner_payment_id',
    ]);
    // A charge still waiting for Super Admin goes back to the shipper's queue.
    await queryRunner.manager
      .createQueryBuilder()
      .update('loads.load_charges')
      .set({ status: 'raised' })
      .where('status = :status', { status: 'pending_admin' })
      .execute();
    await this.setStatuses(queryRunner, ['raised', 'queried', 'approved', 'rejected']);
  }
}
