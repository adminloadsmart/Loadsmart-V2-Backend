import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1786539339066 implements MigrationInterface {
  name = 'InitialSchema1786539339066';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // TypeORM's schema builder/migration-generate never emits these itself (confirmed by
    // reading node_modules/typeorm's PostgresQueryRunner/RdbmsSchemaBuilder — createSchema()
    // exists but is never called automatically) — on staging these already exist by hand;
    // on a genuinely fresh DB (e.g. production) they must be created explicitly, first.
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "auth"`);
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "tracking"`);
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "notifications"`);
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "payments"`);
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "maintenance"`);
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "audit"`);
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "masters"`);
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "customers"`);
    await queryRunner.query(
      `CREATE TYPE "auth"."organization_documents_document_type_enum" AS ENUM('gst_certificate', 'pan', 'udyam', 'aadhaar', 'cin', 'shop_establishment')`,
    );
    await queryRunner.query(
      `CREATE TYPE "auth"."organization_documents_verification_status_enum" AS ENUM('pending', 'verified', 'invalid')`,
    );
    await queryRunner.query(
      `CREATE TABLE "auth"."organization_documents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "document_type" "auth"."organization_documents_document_type_enum" NOT NULL, "document_number" character varying, "file_key" character varying, "verification_status" "auth"."organization_documents_verification_status_enum" NOT NULL DEFAULT 'pending', "is_vaild" boolean NOT NULL DEFAULT false, "registered_name" character varying, "dob" date, "address_line_1" character varying, "address_line_2" character varying, "city" character varying, "district" character varying, "state" character varying, "pin_code" character varying, "source_reference" character varying(100), "raw_response" jsonb, "verified_at" TIMESTAMP WITH TIME ZONE, "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7455629b99d63c33c64386a870d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "organization_documents_org_type_active_unique" ON "auth"."organization_documents"  ("organization_id", "document_type") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "organization_documents_organization_id_idx" ON "auth"."organization_documents"  ("organization_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "auth"."permissions_scope_enum" AS ENUM('platform', 'organization')`,
    );
    await queryRunner.query(
      `CREATE TABLE "auth"."permissions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "key" character varying NOT NULL, "module" character varying NOT NULL, "scope" "auth"."permissions_scope_enum" NOT NULL, "description" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_017943867ed5ceef9c03edd9745" UNIQUE ("key"), CONSTRAINT "PK_920331560282b8bd21bb02290df" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "auth"."roles_scope_enum" AS ENUM('platform', 'organization')`,
    );
    await queryRunner.query(
      `CREATE TABLE "auth"."roles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "scope" "auth"."roles_scope_enum" NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_648e3f5447f725579d7d4ffdfb7" UNIQUE ("name"), CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "auth"."users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid, "phoneNumber" character varying NOT NULL, "full_name" character varying, "email" character varying, "password_hash" character varying, "role_id" uuid NOT NULL, "coverage" character varying, "deleted_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "users_phone_active_unique" ON "auth"."users"  ("phoneNumber") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "users_email_active_unique" ON "auth"."users"  ("email") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "auth"."referral_codes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(40) NOT NULL, "owner_user_id" uuid NOT NULL, "valid_from" date, "valid_until" date, "revoked_at" TIMESTAMP WITH TIME ZONE, "total_signup" integer, "created_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_99f08e2ed9d39d8ce902f5f1f41" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "referral_codes_owner_user_id_idx" ON "auth"."referral_codes"  ("owner_user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "referral_codes_code_unique" ON "auth"."referral_codes"  ("code") `,
    );
    await queryRunner.query(
      `CREATE TYPE "auth"."organizations_status_enum" AS ENUM('active', 'rejected', 'pending', 'partial_pending', 'draft', 'suspended')`,
    );
    await queryRunner.query(
      `CREATE TYPE "auth"."organizations_onboarding_step_enum" AS ENUM('company_details', 'business_details', 'review_submit', 'submitted')`,
    );
    await queryRunner.query(
      `CREATE TYPE "auth"."organizations_journey_stage_enum" AS ENUM('application_submitted', 'online_kyc', 'online_kyc_completed', 'physical_kyc', 'final_approval', 'approved', 'rejected')`,
    );
    await queryRunner.query(
      `CREATE TABLE "auth"."organizations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying, "status" "auth"."organizations_status_enum" NOT NULL, "company_legal_name" character varying, "registered_business_name" character varying, "org_admin_name" character varying, "operational_city" character varying, "onboarding_step" "auth"."organizations_onboarding_step_enum", "registration_date" date, "address_line_1" character varying, "address_line_2" character varying, "city" character varying, "district" character varying, "state" character varying, "pinCode" character varying, "has_own_fleet" boolean, "fleet_size" integer, "referral_code_id" uuid, "online_kyc_verifier_id" uuid, "physical_kyc_agent_id" uuid, "online_kyc_completed_at" TIMESTAMP WITH TIME ZONE, "physical_kyc_approved_at" TIMESTAMP WITH TIME ZONE, "decision_reason" character varying, "journey_stage" "auth"."organizations_journey_stage_enum", "submitted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6b031fcd0863e3f6b44230163f9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "auth"."organization_journey_stage_history_stage_enum" AS ENUM('application_submitted', 'online_kyc', 'online_kyc_completed', 'physical_kyc', 'final_approval', 'approved', 'rejected')`,
    );
    await queryRunner.query(
      `CREATE TABLE "auth"."organization_journey_stage_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "stage" "auth"."organization_journey_stage_history_stage_enum" NOT NULL, "changed_by" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_378a8befa9161f0f4bdd6759893" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "organization_journey_stage_history_org_id_idx" ON "auth"."organization_journey_stage_history"  ("organization_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "auth"."refresh_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" character varying NOT NULL, "token_hash" character varying NOT NULL, "expires_at" TIMESTAMP NOT NULL, "revoked_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "auth"."login_attempts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "success" boolean NOT NULL, "ip_address" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_070e613c8f768b1a70742705c5b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "auth"."user_permissions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "permission_id" uuid NOT NULL, "granted_by" uuid NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_01f4295968ba33d73926684264f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "user_permissions_unique" ON "auth"."user_permissions"  ("user_id", "permission_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "tracking"."tracking_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_cc22ae68e05d9ba5a6575a6f429" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "notifications"."notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "notifications"."notification_templates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "template_id" character varying NOT NULL, "body" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_76f0fc48b8d057d2ae7f3a2848a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "payments"."payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "maintenance"."maintenance_records" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_287b838a22e8c8804262ccdb6a1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "audit"."audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid, "user_id" uuid, "action" character varying, "resource_type" character varying, "old_data" jsonb, "new_data" jsonb, "ip_address" character varying, "user_agent" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."vehicle_documents_document_type_enum" AS ENUM('rc', 'insurance', 'permit', 'puc', 'fitness', 'rc_front', 'rc_back')`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."vehicle_documents_status_enum" AS ENUM('valid', 'expiring_soon', 'expired')`,
    );
    await queryRunner.query(
      `CREATE TABLE "masters"."vehicle_documents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "vehicle_id" uuid NOT NULL, "document_type" "masters"."vehicle_documents_document_type_enum" NOT NULL, "document_number" character varying(50), "issue_date" date, "expiry_date" date, "file_url" text, "status" "masters"."vehicle_documents_status_enum" NOT NULL DEFAULT 'valid', "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d0cc0eb10dcf41a4f35575f5273" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "vehicle_documents_expiry_date_idx" ON "masters"."vehicle_documents"  ("expiry_date") `,
    );
    await queryRunner.query(
      `CREATE INDEX "vehicle_documents_vehicle_id_idx" ON "masters"."vehicle_documents"  ("vehicle_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "vehicle_documents_tenant_id_idx" ON "masters"."vehicle_documents"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."driver_documents_document_type_enum" AS ENUM('driving_license_front', 'driving_license_back')`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."driver_documents_verification_source_enum" AS ENUM('sarathi', 'manual')`,
    );
    await queryRunner.query(
      `CREATE TABLE "masters"."driver_documents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "driver_id" uuid NOT NULL, "document_type" "masters"."driver_documents_document_type_enum" NOT NULL, "file_url" text NOT NULL, "verification_source" "masters"."driver_documents_verification_source_enum" NOT NULL, "verified_at" TIMESTAMP WITH TIME ZONE, "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_31c28b4e8f55a5d411597d45ab2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "driver_documents_driver_id_idx" ON "masters"."driver_documents"  ("driver_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "driver_documents_tenant_id_idx" ON "masters"."driver_documents"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."driver_verifications_verification_type_enum" AS ENUM('sarathi_dl')`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."driver_verifications_verification_status_enum" AS ENUM('pending', 'verified', 'not_found', 'manual_review')`,
    );
    await queryRunner.query(
      `CREATE TABLE "masters"."driver_verifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "driver_id" uuid NOT NULL, "verification_type" "masters"."driver_verifications_verification_type_enum" NOT NULL, "verification_status" "masters"."driver_verifications_verification_status_enum" NOT NULL DEFAULT 'pending', "source_reference" character varying(100), "holder_name" character varying(150), "license_number" character varying(30), "valid_until" date, "license_class" character varying(100), "license_status" character varying(150), "address_line_1" character varying(255), "address_line_2" character varying(255), "city" character varying(100), "pin_code" character varying(10), "raw_response" jsonb, "verified_at" TIMESTAMP WITH TIME ZONE, "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5da6e889c6abf4fd516c0835a00" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "driver_verifications_driver_id_idx" ON "masters"."driver_verifications"  ("driver_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "driver_verifications_tenant_id_idx" ON "masters"."driver_verifications"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."driver_bank_details_verification_status_enum" AS ENUM('pending', 'verified', 'rejected')`,
    );
    await queryRunner.query(
      `CREATE TABLE "masters"."driver_bank_details" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "driver_id" uuid NOT NULL, "account_number" character varying(30) NOT NULL, "ifsc" character varying(11) NOT NULL, "account_holder_name" character varying(150), "verification_status" "masters"."driver_bank_details_verification_status_enum" NOT NULL DEFAULT 'pending', "verified_at" TIMESTAMP WITH TIME ZONE, "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ae43ae666b250b837f40ac0c8b9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "driver_bank_details_driver_id_idx" ON "masters"."driver_bank_details"  ("driver_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "driver_bank_details_tenant_id_idx" ON "masters"."driver_bank_details"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."driver_operational_statuses_operational_status_enum" AS ENUM('active', 'on_trip', 'on_leave', 'inactive')`,
    );
    await queryRunner.query(
      `CREATE TABLE "masters"."driver_operational_statuses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "driver_id" uuid NOT NULL, "operational_status" "masters"."driver_operational_statuses_operational_status_enum" NOT NULL DEFAULT 'active', "reason" text, "effective_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "REL_d8b7281f96a0e85d5c88682fe3" UNIQUE ("driver_id"), CONSTRAINT "PK_b99c080b663be2498336324d5ef" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "driver_operational_statuses_driver_id_unique" ON "masters"."driver_operational_statuses"  ("driver_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "driver_operational_statuses_tenant_id_idx" ON "masters"."driver_operational_statuses"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "masters"."driver_trip_metrics" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "driver_id" uuid NOT NULL, "period_start" date NOT NULL, "period_end" date NOT NULL, "trips_count" integer NOT NULL DEFAULT '0', "on_time_percentage" numeric(5,2) NOT NULL DEFAULT '0', "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7915aaa0f49232953d9c0595127" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "driver_trip_metrics_driver_period_unique" ON "masters"."driver_trip_metrics"  ("tenant_id", "driver_id", "period_start", "period_end") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "driver_trip_metrics_driver_id_idx" ON "masters"."driver_trip_metrics"  ("driver_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "driver_trip_metrics_tenant_id_idx" ON "masters"."driver_trip_metrics"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."drivers_status_enum" AS ENUM('active', 'inactive', 'on_trip', 'on_leave')`,
    );
    await queryRunner.query(
      `CREATE TABLE "masters"."drivers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "full_name" character varying(150) NOT NULL, "phone_number" character varying(15) NOT NULL, "license_number" character varying(30), "license_verified" boolean NOT NULL DEFAULT false, "license_expiry" date, "date_of_joining" date, "status" "masters"."drivers_status_enum" NOT NULL DEFAULT 'active', "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_92ab3fb69e566d3eb0cae896047" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "drivers_tenant_license_number_active_unique" ON "masters"."drivers"  ("tenant_id", "license_number") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "drivers_tenant_phone_number_active_unique" ON "masters"."drivers"  ("tenant_id", "phone_number") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "drivers_tenant_id_idx" ON "masters"."drivers"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."fleet_driver_links_status_enum" AS ENUM('active', 'ended')`,
    );
    await queryRunner.query(
      `CREATE TABLE "masters"."fleet_driver_links" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "vehicle_id" uuid NOT NULL, "driver_id" uuid NOT NULL, "is_primary" boolean NOT NULL DEFAULT true, "linked_from" date NOT NULL DEFAULT ('now'::text)::date, "linked_to" date, "status" "masters"."fleet_driver_links_status_enum" NOT NULL DEFAULT 'active', "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ec421e338c41af179968d2a6f87" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "fleet_driver_links_driver_id_idx" ON "masters"."fleet_driver_links"  ("driver_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "fleet_driver_links_vehicle_id_idx" ON "masters"."fleet_driver_links"  ("vehicle_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "fleet_driver_links_tenant_id_idx" ON "masters"."fleet_driver_links"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "masters"."truck_types" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "name" character varying(100) NOT NULL, "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7d5054b9f8e5274d41f642bed2b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "truck_types_tenant_name_active_unique" ON "masters"."truck_types"  ("tenant_id", "name") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "truck_types_tenant_id_idx" ON "masters"."truck_types"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."vehicle_operational_statuses_operational_status_enum" AS ENUM('on_trip', 'idle', 'warn_on_assign', 'inactive')`,
    );
    await queryRunner.query(
      `CREATE TABLE "masters"."vehicle_operational_statuses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "vehicle_id" uuid NOT NULL, "operational_status" "masters"."vehicle_operational_statuses_operational_status_enum" NOT NULL DEFAULT 'idle', "reason" text, "effective_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "REL_ccc5ab2e82900d30a50e6e9b36" UNIQUE ("vehicle_id"), CONSTRAINT "PK_baa4c8b557999aa769137c951ff" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "vehicle_operational_statuses_vehicle_id_unique" ON "masters"."vehicle_operational_statuses"  ("vehicle_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "vehicle_operational_statuses_tenant_id_idx" ON "masters"."vehicle_operational_statuses"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "masters"."vehicle_telemetry_meta" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "vehicle_id" uuid NOT NULL, "gps_provider" character varying(100), "gps_enabled" boolean NOT NULL DEFAULT false, "emi_amount" numeric(12,2), "emi_end_date" date, "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "REL_0b83a2447a3d6cc8893b0dd072" UNIQUE ("vehicle_id"), CONSTRAINT "PK_980cd9441ed3f4269ee38d909ed" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "vehicle_telemetry_meta_vehicle_id_unique" ON "masters"."vehicle_telemetry_meta"  ("vehicle_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "vehicle_telemetry_meta_tenant_id_idx" ON "masters"."vehicle_telemetry_meta"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."vehicle_verification_snapshots_verification_type_enum" AS ENUM('vahan')`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."vehicle_verification_snapshots_verification_status_enum" AS ENUM('pending', 'verified', 'not_found', 'manual_review')`,
    );
    await queryRunner.query(
      `CREATE TABLE "masters"."vehicle_verification_snapshots" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "vehicle_id" uuid NOT NULL, "verification_type" "masters"."vehicle_verification_snapshots_verification_type_enum" NOT NULL DEFAULT 'vahan', "verification_status" "masters"."vehicle_verification_snapshots_verification_status_enum" NOT NULL DEFAULT 'pending', "source_reference" character varying(100), "registered_name" character varying(150), "registered_on" date, "vehicle_class" character varying(100), "address_line1" character varying(255), "address_line2" character varying(255), "city" character varying(100), "pin_code" character varying(10), "response_payload" jsonb, "verified_at" TIMESTAMP WITH TIME ZONE, "checked_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_dc1bcefd9dfa711a41488300ea3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "vehicle_verification_snapshots_checked_at_idx" ON "masters"."vehicle_verification_snapshots"  ("checked_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "vehicle_verification_snapshots_vehicle_id_idx" ON "masters"."vehicle_verification_snapshots"  ("vehicle_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "vehicle_verification_snapshots_tenant_id_idx" ON "masters"."vehicle_verification_snapshots"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "masters"."vehicle_service_usage" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "vehicle_id" uuid NOT NULL, "odometer_km" integer, "last_service_date" date, "last_service_odometer_km" integer, "last_tyre_change_brand" character varying(100), "last_tyre_change_date" date, "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "REL_723db4e6381ac98a2f221e5272" UNIQUE ("vehicle_id"), CONSTRAINT "PK_c0af7dbd043a849f5dc057c6583" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "vehicle_service_usage_vehicle_id_unique" ON "masters"."vehicle_service_usage"  ("vehicle_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "vehicle_service_usage_tenant_id_idx" ON "masters"."vehicle_service_usage"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."vehicles_fuel_type_enum" AS ENUM('diesel', 'petrol', 'cng', 'electric')`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."vehicles_body_type_enum" AS ENUM('open', 'closed', 'flat_bed', 'container', 'low_bed')`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."vehicles_ownership_type_enum" AS ENUM('owned', 'leased', 'attached')`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."vehicles_status_enum" AS ENUM('active', 'inactive', 'under_maintenance')`,
    );
    await queryRunner.query(
      `CREATE TABLE "masters"."vehicles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "registration_number" character varying(20) NOT NULL, "truck_type_id" uuid, "fuel_type" "masters"."vehicles_fuel_type_enum", "body_type" "masters"."vehicles_body_type_enum", "wheel_count" smallint, "capacity_tons" numeric(6,2), "ownership_type" "masters"."vehicles_ownership_type_enum" NOT NULL DEFAULT 'owned', "status" "masters"."vehicles_status_enum" NOT NULL DEFAULT 'active', "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_18d8646b59304dce4af3a9e35b6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "vehicles_tenant_registration_active_unique" ON "masters"."vehicles"  ("tenant_id", "registration_number") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "vehicles_tenant_id_idx" ON "masters"."vehicles"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "customers"."customer_delivery_points" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "customer_id" uuid NOT NULL, "tenant_id" uuid NOT NULL, "location" character varying(255) NOT NULL, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_189587d3d6125f01cbe9076bfcf" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "customer_delivery_points_tenant_customer_idx" ON "customers"."customer_delivery_points"  ("tenant_id", "customer_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "customers"."customers_status_enum" AS ENUM('pending', 'active')`,
    );
    await queryRunner.query(
      `CREATE TABLE "customers"."customers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "name" character varying(150) NOT NULL, "mobile" character varying(15) NOT NULL, "email" character varying, "gstin" character varying(15), "advance_percentage" numeric(5,2), "credit_days" integer, "rate_contract" character varying, "status" "customers"."customers_status_enum" NOT NULL DEFAULT 'pending', "created_by" uuid NOT NULL, "approved_by" uuid, "approved_at" TIMESTAMP WITH TIME ZONE, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_133ec679a801fab5e070f73d3ea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "customers_tenant_name_idx" ON "customers"."customers"  ("tenant_id", "name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "customers_tenant_status_idx" ON "customers"."customers"  ("tenant_id", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "customers_tenant_id_idx" ON "customers"."customers"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "auth"."role_permissions" ("role_id" uuid NOT NULL, "permission_id" uuid NOT NULL, CONSTRAINT "PK_25d24010f53bb80b78e412c9656" PRIMARY KEY ("role_id", "permission_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_178199805b901ccd220ab7740e" ON "auth"."role_permissions"  ("role_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_17022daf3f885f7d35423e9971" ON "auth"."role_permissions"  ("permission_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."organization_documents" ADD CONSTRAINT "FK_3a028be3e263bf8bf5dc2e46759" FOREIGN KEY ("organization_id") REFERENCES "auth"."organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."users" ADD CONSTRAINT "FK_109638590074998bb72a2f2cf08" FOREIGN KEY ("tenant_id") REFERENCES "auth"."organizations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."users" ADD CONSTRAINT "FK_a2cecd1a3531c0b041e29ba46e1" FOREIGN KEY ("role_id") REFERENCES "auth"."roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."referral_codes" ADD CONSTRAINT "FK_33ee7c85416567fb5b0db3006d0" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."organizations" ADD CONSTRAINT "FK_abef4214cbd7ec3c7aeb7cd21e9" FOREIGN KEY ("referral_code_id") REFERENCES "auth"."referral_codes"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."organizations" ADD CONSTRAINT "FK_46a754e4abf2a77beed4a28402c" FOREIGN KEY ("online_kyc_verifier_id") REFERENCES "auth"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."organizations" ADD CONSTRAINT "FK_b2557019ef3f9a2d22ecb6360c7" FOREIGN KEY ("physical_kyc_agent_id") REFERENCES "auth"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."organization_journey_stage_history" ADD CONSTRAINT "FK_09410231594fc02ccd77afd30e6" FOREIGN KEY ("organization_id") REFERENCES "auth"."organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."organization_journey_stage_history" ADD CONSTRAINT "FK_5093ad16a3336ddfb8572af065c" FOREIGN KEY ("changed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."user_permissions" ADD CONSTRAINT "FK_3495bd31f1862d02931e8e8d2e8" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."user_permissions" ADD CONSTRAINT "FK_8145f5fadacd311693c15e41f10" FOREIGN KEY ("permission_id") REFERENCES "auth"."permissions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit"."audit_logs" ADD CONSTRAINT "FK_6f18d459490bb48923b1f40bdb7" FOREIGN KEY ("tenant_id") REFERENCES "auth"."organizations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit"."audit_logs" ADD CONSTRAINT "FK_bd2726fd31b35443f2245b93ba0" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_documents" ADD CONSTRAINT "FK_8215ef09586915f4ab3e7db0162" FOREIGN KEY ("vehicle_id") REFERENCES "masters"."vehicles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_documents" ADD CONSTRAINT "FK_dc156b37dfa0fcda0ef1974bab8" FOREIGN KEY ("driver_id") REFERENCES "masters"."drivers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_verifications" ADD CONSTRAINT "FK_1dcbe73b4b58f32ff268c05cc55" FOREIGN KEY ("driver_id") REFERENCES "masters"."drivers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_bank_details" ADD CONSTRAINT "FK_db5d82e059d345446db6f8be634" FOREIGN KEY ("driver_id") REFERENCES "masters"."drivers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_operational_statuses" ADD CONSTRAINT "FK_d8b7281f96a0e85d5c88682fe3d" FOREIGN KEY ("driver_id") REFERENCES "masters"."drivers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_trip_metrics" ADD CONSTRAINT "FK_a4a10eb593b745406360e5954d0" FOREIGN KEY ("driver_id") REFERENCES "masters"."drivers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."fleet_driver_links" ADD CONSTRAINT "FK_550b6c839eeb98296a6d908d3f5" FOREIGN KEY ("vehicle_id") REFERENCES "masters"."vehicles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."fleet_driver_links" ADD CONSTRAINT "FK_01f6c39bb1002940f16c91cd40d" FOREIGN KEY ("driver_id") REFERENCES "masters"."drivers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_operational_statuses" ADD CONSTRAINT "FK_ccc5ab2e82900d30a50e6e9b366" FOREIGN KEY ("vehicle_id") REFERENCES "masters"."vehicles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_telemetry_meta" ADD CONSTRAINT "FK_0b83a2447a3d6cc8893b0dd0728" FOREIGN KEY ("vehicle_id") REFERENCES "masters"."vehicles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_verification_snapshots" ADD CONSTRAINT "FK_532eaf346592368333cba8e754c" FOREIGN KEY ("vehicle_id") REFERENCES "masters"."vehicles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_service_usage" ADD CONSTRAINT "FK_723db4e6381ac98a2f221e52728" FOREIGN KEY ("vehicle_id") REFERENCES "masters"."vehicles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicles" ADD CONSTRAINT "FK_d1598a63e989cf5e966fe0a023a" FOREIGN KEY ("truck_type_id") REFERENCES "masters"."truck_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" ADD CONSTRAINT "FK_9054a81c11f1344cf31215cadeb" FOREIGN KEY ("customer_id") REFERENCES "customers"."customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."role_permissions" ADD CONSTRAINT "FK_178199805b901ccd220ab7740ec" FOREIGN KEY ("role_id") REFERENCES "auth"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."role_permissions" ADD CONSTRAINT "FK_17022daf3f885f7d35423e9971e" FOREIGN KEY ("permission_id") REFERENCES "auth"."permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth"."role_permissions" DROP CONSTRAINT "FK_17022daf3f885f7d35423e9971e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."role_permissions" DROP CONSTRAINT "FK_178199805b901ccd220ab7740ec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" DROP CONSTRAINT "FK_9054a81c11f1344cf31215cadeb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicles" DROP CONSTRAINT "FK_d1598a63e989cf5e966fe0a023a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_service_usage" DROP CONSTRAINT "FK_723db4e6381ac98a2f221e52728"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_verification_snapshots" DROP CONSTRAINT "FK_532eaf346592368333cba8e754c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_telemetry_meta" DROP CONSTRAINT "FK_0b83a2447a3d6cc8893b0dd0728"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_operational_statuses" DROP CONSTRAINT "FK_ccc5ab2e82900d30a50e6e9b366"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."fleet_driver_links" DROP CONSTRAINT "FK_01f6c39bb1002940f16c91cd40d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."fleet_driver_links" DROP CONSTRAINT "FK_550b6c839eeb98296a6d908d3f5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_trip_metrics" DROP CONSTRAINT "FK_a4a10eb593b745406360e5954d0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_operational_statuses" DROP CONSTRAINT "FK_d8b7281f96a0e85d5c88682fe3d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_bank_details" DROP CONSTRAINT "FK_db5d82e059d345446db6f8be634"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_verifications" DROP CONSTRAINT "FK_1dcbe73b4b58f32ff268c05cc55"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_documents" DROP CONSTRAINT "FK_dc156b37dfa0fcda0ef1974bab8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_documents" DROP CONSTRAINT "FK_8215ef09586915f4ab3e7db0162"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit"."audit_logs" DROP CONSTRAINT "FK_bd2726fd31b35443f2245b93ba0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit"."audit_logs" DROP CONSTRAINT "FK_6f18d459490bb48923b1f40bdb7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."user_permissions" DROP CONSTRAINT "FK_8145f5fadacd311693c15e41f10"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."user_permissions" DROP CONSTRAINT "FK_3495bd31f1862d02931e8e8d2e8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."organization_journey_stage_history" DROP CONSTRAINT "FK_5093ad16a3336ddfb8572af065c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."organization_journey_stage_history" DROP CONSTRAINT "FK_09410231594fc02ccd77afd30e6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."organizations" DROP CONSTRAINT "FK_b2557019ef3f9a2d22ecb6360c7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."organizations" DROP CONSTRAINT "FK_46a754e4abf2a77beed4a28402c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."organizations" DROP CONSTRAINT "FK_abef4214cbd7ec3c7aeb7cd21e9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."referral_codes" DROP CONSTRAINT "FK_33ee7c85416567fb5b0db3006d0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."users" DROP CONSTRAINT "FK_a2cecd1a3531c0b041e29ba46e1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."users" DROP CONSTRAINT "FK_109638590074998bb72a2f2cf08"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."organization_documents" DROP CONSTRAINT "FK_3a028be3e263bf8bf5dc2e46759"`,
    );
    await queryRunner.query(`DROP INDEX "auth"."IDX_17022daf3f885f7d35423e9971"`);
    await queryRunner.query(`DROP INDEX "auth"."IDX_178199805b901ccd220ab7740e"`);
    await queryRunner.query(`DROP TABLE "auth"."role_permissions"`);
    await queryRunner.query(`DROP INDEX "customers"."customers_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "customers"."customers_tenant_status_idx"`);
    await queryRunner.query(`DROP INDEX "customers"."customers_tenant_name_idx"`);
    await queryRunner.query(`DROP TABLE "customers"."customers"`);
    await queryRunner.query(`DROP TYPE "customers"."customers_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "customers"."customer_delivery_points_tenant_customer_idx"`,
    );
    await queryRunner.query(`DROP TABLE "customers"."customer_delivery_points"`);
    await queryRunner.query(`DROP INDEX "masters"."vehicles_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."vehicles_tenant_registration_active_unique"`);
    await queryRunner.query(`DROP TABLE "masters"."vehicles"`);
    await queryRunner.query(`DROP TYPE "masters"."vehicles_status_enum"`);
    await queryRunner.query(`DROP TYPE "masters"."vehicles_ownership_type_enum"`);
    await queryRunner.query(`DROP TYPE "masters"."vehicles_body_type_enum"`);
    await queryRunner.query(`DROP TYPE "masters"."vehicles_fuel_type_enum"`);
    await queryRunner.query(`DROP INDEX "masters"."vehicle_service_usage_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."vehicle_service_usage_vehicle_id_unique"`);
    await queryRunner.query(`DROP TABLE "masters"."vehicle_service_usage"`);
    await queryRunner.query(`DROP INDEX "masters"."vehicle_verification_snapshots_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."vehicle_verification_snapshots_vehicle_id_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."vehicle_verification_snapshots_checked_at_idx"`);
    await queryRunner.query(`DROP TABLE "masters"."vehicle_verification_snapshots"`);
    await queryRunner.query(
      `DROP TYPE "masters"."vehicle_verification_snapshots_verification_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "masters"."vehicle_verification_snapshots_verification_type_enum"`,
    );
    await queryRunner.query(`DROP INDEX "masters"."vehicle_telemetry_meta_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."vehicle_telemetry_meta_vehicle_id_unique"`);
    await queryRunner.query(`DROP TABLE "masters"."vehicle_telemetry_meta"`);
    await queryRunner.query(`DROP INDEX "masters"."vehicle_operational_statuses_tenant_id_idx"`);
    await queryRunner.query(
      `DROP INDEX "masters"."vehicle_operational_statuses_vehicle_id_unique"`,
    );
    await queryRunner.query(`DROP TABLE "masters"."vehicle_operational_statuses"`);
    await queryRunner.query(
      `DROP TYPE "masters"."vehicle_operational_statuses_operational_status_enum"`,
    );
    await queryRunner.query(`DROP INDEX "masters"."truck_types_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."truck_types_tenant_name_active_unique"`);
    await queryRunner.query(`DROP TABLE "masters"."truck_types"`);
    await queryRunner.query(`DROP INDEX "masters"."fleet_driver_links_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."fleet_driver_links_vehicle_id_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."fleet_driver_links_driver_id_idx"`);
    await queryRunner.query(`DROP TABLE "masters"."fleet_driver_links"`);
    await queryRunner.query(`DROP TYPE "masters"."fleet_driver_links_status_enum"`);
    await queryRunner.query(`DROP INDEX "masters"."drivers_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."drivers_tenant_phone_number_active_unique"`);
    await queryRunner.query(`DROP INDEX "masters"."drivers_tenant_license_number_active_unique"`);
    await queryRunner.query(`DROP TABLE "masters"."drivers"`);
    await queryRunner.query(`DROP TYPE "masters"."drivers_status_enum"`);
    await queryRunner.query(`DROP INDEX "masters"."driver_trip_metrics_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."driver_trip_metrics_driver_id_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."driver_trip_metrics_driver_period_unique"`);
    await queryRunner.query(`DROP TABLE "masters"."driver_trip_metrics"`);
    await queryRunner.query(`DROP INDEX "masters"."driver_operational_statuses_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."driver_operational_statuses_driver_id_unique"`);
    await queryRunner.query(`DROP TABLE "masters"."driver_operational_statuses"`);
    await queryRunner.query(
      `DROP TYPE "masters"."driver_operational_statuses_operational_status_enum"`,
    );
    await queryRunner.query(`DROP INDEX "masters"."driver_bank_details_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."driver_bank_details_driver_id_idx"`);
    await queryRunner.query(`DROP TABLE "masters"."driver_bank_details"`);
    await queryRunner.query(`DROP TYPE "masters"."driver_bank_details_verification_status_enum"`);
    await queryRunner.query(`DROP INDEX "masters"."driver_verifications_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."driver_verifications_driver_id_idx"`);
    await queryRunner.query(`DROP TABLE "masters"."driver_verifications"`);
    await queryRunner.query(`DROP TYPE "masters"."driver_verifications_verification_status_enum"`);
    await queryRunner.query(`DROP TYPE "masters"."driver_verifications_verification_type_enum"`);
    await queryRunner.query(`DROP INDEX "masters"."driver_documents_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."driver_documents_driver_id_idx"`);
    await queryRunner.query(`DROP TABLE "masters"."driver_documents"`);
    await queryRunner.query(`DROP TYPE "masters"."driver_documents_verification_source_enum"`);
    await queryRunner.query(`DROP TYPE "masters"."driver_documents_document_type_enum"`);
    await queryRunner.query(`DROP INDEX "masters"."vehicle_documents_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."vehicle_documents_vehicle_id_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."vehicle_documents_expiry_date_idx"`);
    await queryRunner.query(`DROP TABLE "masters"."vehicle_documents"`);
    await queryRunner.query(`DROP TYPE "masters"."vehicle_documents_status_enum"`);
    await queryRunner.query(`DROP TYPE "masters"."vehicle_documents_document_type_enum"`);
    await queryRunner.query(`DROP TABLE "audit"."audit_logs"`);
    await queryRunner.query(`DROP TABLE "maintenance"."maintenance_records"`);
    await queryRunner.query(`DROP TABLE "payments"."payments"`);
    await queryRunner.query(`DROP TABLE "notifications"."notification_templates"`);
    await queryRunner.query(`DROP TABLE "notifications"."notifications"`);
    await queryRunner.query(`DROP TABLE "tracking"."tracking_events"`);
    await queryRunner.query(`DROP INDEX "auth"."user_permissions_unique"`);
    await queryRunner.query(`DROP TABLE "auth"."user_permissions"`);
    await queryRunner.query(`DROP TABLE "auth"."login_attempts"`);
    await queryRunner.query(`DROP TABLE "auth"."refresh_tokens"`);
    await queryRunner.query(`DROP INDEX "auth"."organization_journey_stage_history_org_id_idx"`);
    await queryRunner.query(`DROP TABLE "auth"."organization_journey_stage_history"`);
    await queryRunner.query(`DROP TYPE "auth"."organization_journey_stage_history_stage_enum"`);
    await queryRunner.query(`DROP TABLE "auth"."organizations"`);
    await queryRunner.query(`DROP TYPE "auth"."organizations_journey_stage_enum"`);
    await queryRunner.query(`DROP TYPE "auth"."organizations_onboarding_step_enum"`);
    await queryRunner.query(`DROP TYPE "auth"."organizations_status_enum"`);
    await queryRunner.query(`DROP INDEX "auth"."referral_codes_code_unique"`);
    await queryRunner.query(`DROP INDEX "auth"."referral_codes_owner_user_id_idx"`);
    await queryRunner.query(`DROP TABLE "auth"."referral_codes"`);
    await queryRunner.query(`DROP INDEX "auth"."users_email_active_unique"`);
    await queryRunner.query(`DROP INDEX "auth"."users_phone_active_unique"`);
    await queryRunner.query(`DROP TABLE "auth"."users"`);
    await queryRunner.query(`DROP TABLE "auth"."roles"`);
    await queryRunner.query(`DROP TYPE "auth"."roles_scope_enum"`);
    await queryRunner.query(`DROP TABLE "auth"."permissions"`);
    await queryRunner.query(`DROP TYPE "auth"."permissions_scope_enum"`);
    await queryRunner.query(`DROP INDEX "auth"."organization_documents_organization_id_idx"`);
    await queryRunner.query(`DROP INDEX "auth"."organization_documents_org_type_active_unique"`);
    await queryRunner.query(`DROP TABLE "auth"."organization_documents"`);
    await queryRunner.query(`DROP TYPE "auth"."organization_documents_verification_status_enum"`);
    await queryRunner.query(`DROP TYPE "auth"."organization_documents_document_type_enum"`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "customers"`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "masters"`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "audit"`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "maintenance"`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "payments"`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "notifications"`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "tracking"`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "auth"`);
  }
}
