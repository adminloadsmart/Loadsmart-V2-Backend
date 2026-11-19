import { MigrationInterface, QueryRunner, Table, TableCheck, TableIndex } from 'typeorm';

/** The broker directory (Masters → Brokers): firm, contact, base, the trucks they source, their
 *  lane, TDS, approval status and the figures shown on the list. */
export class Brokers1795400000000 implements MigrationInterface {
  name = 'Brokers1795400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        schema: 'loads',
        name: 'brokers',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'uuid_generate_v4()' },
          { name: 'trucker_company', type: 'varchar', length: '200' },
          { name: 'trucker_name', type: 'varchar', length: '150' },
          { name: 'phone', type: 'varchar', length: '15' },
          { name: 'is_on_whatsapp', type: 'boolean', default: true },
          { name: 'email', type: 'varchar', length: '255', isNullable: true },
          { name: 'base', type: 'varchar', length: '100' },
          { name: 'truck_sources', type: 'text', isArray: true, default: "'{}'" },
          { name: 'lane_origin', type: 'varchar', length: '100' },
          { name: 'lane_destinations', type: 'text', isArray: true, default: "'{}'" },
          { name: 'tds_percent', type: 'numeric', precision: 5, scale: 2, default: 1 },
          { name: 'loads_last_30_days', type: 'integer', default: 0 },
          { name: 'rating', type: 'numeric', precision: 2, scale: 1, isNullable: true },
          { name: 'status', type: 'varchar', length: '20', default: "'awaiting_approval'" },
          { name: 'hold_reason', type: 'varchar', length: '200', isNullable: true },
          { name: 'pending_original_pods', type: 'integer', default: 0 },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
        checks: [
          new TableCheck({
            name: 'brokers_status_chk',
            expression: "status IN ('approved', 'awaiting_approval', 'on_hold', 'rejected')",
          }),
        ],
        indices: [
          new TableIndex({ name: 'brokers_phone_uq', columnNames: ['phone'], isUnique: true }),
          new TableIndex({ name: 'brokers_status_idx', columnNames: ['status'] }),
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('loads.brokers', true);
  }
}
