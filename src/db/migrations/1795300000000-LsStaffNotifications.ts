import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/** The ops console's own in-app inbox for platform staff (the shared notifications module is
 *  tenant-scoped, so staff cannot read it). Used first for "advance raised" → Payables + Super Admin. */
export class LsStaffNotifications1795300000000 implements MigrationInterface {
  name = 'LsStaffNotifications1795300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        schema: 'loads',
        name: 'ls_staff_notifications',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'recipient_user_id', type: 'uuid' },
          { name: 'type', type: 'varchar', length: '60' },
          { name: 'title', type: 'varchar', length: '200' },
          { name: 'body', type: 'text' },
          { name: 'load_id', type: 'uuid', isNullable: true },
          { name: 'metadata', type: 'jsonb', default: "'{}'" },
          { name: 'read_at', type: 'timestamptz', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
        ],
        indices: [
          new TableIndex({
            name: 'ls_staff_notifications_recipient_idx',
            columnNames: ['recipient_user_id', 'read_at', 'created_at'],
          }),
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('loads.ls_staff_notifications', true);
  }
}
