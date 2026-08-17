import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Referral codes: drop valid_from (the "upcoming" status derived from it is gone — status is now
 * just active/expired/revoked), and drop owner_user_id's NOT NULL constraint (a code can now be
 * created before a sales rep is assigned, and given one later via PATCH). The FK to
 * auth.users(id) ON DELETE RESTRICT is untouched — only its NOT NULL is dropped.
 */
export class RemoveValidFromAndMakeReferralCodeOwnerOptional1786800000000 implements MigrationInterface {
  name = 'RemoveValidFromAndMakeReferralCodeOwnerOptional1786800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth"."referral_codes" DROP COLUMN IF EXISTS "valid_from"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."referral_codes" ALTER COLUMN "owner_user_id" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auth"."referral_codes" ADD "valid_from" date`);
    // owner_user_id NOT NULL is not restored — rows created with a null owner after this
    // migration ran would violate it, and there's no safe value to backfill them with.
  }
}
