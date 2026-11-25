import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/** The shipper's question on a charge and Tracking's answer: who asked, what they attached, who
 *  answered, the kind of answer and the proof sent with it. */
export class ChargeQueryThread1795510000000 implements MigrationInterface {
  name = 'ChargeQueryThread1795510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('loads.load_charges', [
      new TableColumn({ name: 'queried_by', type: 'uuid', isNullable: true }),
      new TableColumn({ name: 'query_file_key', type: 'text', isNullable: true }),
      new TableColumn({ name: 'replied_by', type: 'uuid', isNullable: true }),
      new TableColumn({ name: 'reply_tag', type: 'varchar', length: '40', isNullable: true }),
      new TableColumn({ name: 'reply_file_key', type: 'text', isNullable: true }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumns('loads.load_charges', [
      'queried_by',
      'query_file_key',
      'replied_by',
      'reply_tag',
      'reply_file_key',
    ]);
  }
}
