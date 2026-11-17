import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/** Tracking's call log: every call about a load, with the truck's location and ETA when given. */
export class LsCallLogs1795340000000 implements MigrationInterface {
  name = 'LsCallLogs1795340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        schema: 'loads',
        name: 'ls_call_logs',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'uuid_generate_v4()' },
          { name: 'tenant_id', type: 'uuid' },
          { name: 'load_id', type: 'uuid' },
          { name: 'sourcing_id', type: 'uuid' },
          { name: 'called_by', type: 'uuid' },
          { name: 'called_at', type: 'timestamptz' },
          { name: 'contact', type: 'varchar', length: '20' },
          { name: 'phone', type: 'varchar', length: '20', isNullable: true },
          { name: 'outcome', type: 'varchar', length: '20' },
          { name: 'note', type: 'varchar', length: '1000', isNullable: true },
          { name: 'location_label', type: 'varchar', length: '200', isNullable: true },
          { name: 'latitude', type: 'numeric', precision: 9, scale: 6, isNullable: true },
          { name: 'longitude', type: 'numeric', precision: 9, scale: 6, isNullable: true },
          { name: 'location_source', type: 'varchar', length: '20', isNullable: true },
          { name: 'eta_at', type: 'timestamptz', isNullable: true },
          { name: 'eta_target', type: 'varchar', length: '20', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
        ],
        indices: [
          new TableIndex({ name: 'ls_call_logs_load_idx', columnNames: ['load_id', 'called_at'] }),
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('loads.ls_call_logs', true);
  }
}
