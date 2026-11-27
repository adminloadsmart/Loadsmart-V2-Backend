import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The shipper's counter on one of Loadsmart's bids, taken to the broker behind it by Placement:
 * the rate offered to the broker (trip total — the counter less Loadsmart's margin), when and by
 * whom. Kept on the broker's bid because Loadsmart can have several bids with the shipper at once.
 */
export class PartnerBidBrokerCounter1795550000000 implements MigrationInterface {
  name = 'PartnerBidBrokerCounter1795550000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_partner_bids"
         ADD COLUMN IF NOT EXISTS "broker_counter_rate" numeric(12,2),
         ADD COLUMN IF NOT EXISTS "broker_counter_sent_at" timestamptz,
         ADD COLUMN IF NOT EXISTS "broker_counter_sent_by" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_partner_bids"
         DROP COLUMN IF EXISTS "broker_counter_rate",
         DROP COLUMN IF EXISTS "broker_counter_sent_at",
         DROP COLUMN IF EXISTS "broker_counter_sent_by"`,
    );
  }
}
