import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ORGANIZATION_JOURNEY_STAGES (organization.entity.ts) was renamed without a migration:
 * 'online_kyc' -> 'online_kyc_handover', 'physical_kyc' -> 'physical_kyc_handover',
 * 'final_approval' -> 'physical_kyc_completed'. Same 7 values, same slot meanings, so this is a
 * pure relabel — RENAME VALUE keeps every existing row pointing at its current stage under the
 * new name, no backfill needed. Applies to both enum types backed by this value set:
 * organizations.journey_stage and organization_journey_stage_history.stage.
 */
export class RenameOrganizationJourneyStages1787500000000 implements MigrationInterface {
  name = 'RenameOrganizationJourneyStages1787500000000';

  private static readonly ENUM_TYPES = [
    'organizations_journey_stage_enum',
    'organization_journey_stage_history_stage_enum',
  ];

  private static readonly RENAMES: Array<[string, string]> = [
    ['online_kyc', 'online_kyc_handover'],
    ['physical_kyc', 'physical_kyc_handover'],
    ['final_approval', 'physical_kyc_completed'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const enumType of RenameOrganizationJourneyStages1787500000000.ENUM_TYPES) {
      for (const [from, to] of RenameOrganizationJourneyStages1787500000000.RENAMES) {
        await queryRunner.query(
          `ALTER TYPE "auth"."${enumType}" RENAME VALUE '${from}' TO '${to}'`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const enumType of RenameOrganizationJourneyStages1787500000000.ENUM_TYPES) {
      for (const [from, to] of [
        ...RenameOrganizationJourneyStages1787500000000.RENAMES,
      ].reverse()) {
        await queryRunner.query(
          `ALTER TYPE "auth"."${enumType}" RENAME VALUE '${to}' TO '${from}'`,
        );
      }
    }
  }
}
