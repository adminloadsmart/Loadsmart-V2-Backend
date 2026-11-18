import { MigrationInterface, QueryRunner } from 'typeorm';

// Provider-neutral WhatsApp messaging (Meta now, MSG91 later): message_log (every outbound
// message + its delivery statuses) and whatsapp_inbound (every reply + how it was routed).
export class CreateWhatsappMessaging1794200000000 implements MigrationInterface {
  name = 'CreateWhatsappMessaging1794200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "notifications"."message_log" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid,
        "load_id" uuid,
        "load_ref" varchar(64),
        "recipient_kind" varchar(32) NOT NULL,
        "recipient_ref_id" varchar(64),
        "recipient_name" varchar(200),
        "address" varchar(200) NOT NULL,
        "channel" varchar(16) NOT NULL,
        "provider" varchar(16),
        "kind" varchar(32),
        "template_key" varchar(100),
        "variables" jsonb,
        "rendered_text" text,
        "intent" varchar(16),
        "status" varchar(16) NOT NULL DEFAULT 'queued',
        "suppressed_reason" varchar(100),
        "provider_message_id" varchar(255),
        "provider_request_id" varchar(255),
        "reply_to_inbound_id" uuid,
        "sent_at" timestamptz,
        "delivered_at" timestamptz,
        "read_at" timestamptz,
        "failed_at" timestamptz,
        "error" jsonb,
        "actor" varchar(100),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "message_log_pk" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "message_log_provider_message_id_unique" ON "notifications"."message_log" ("provider_message_id") WHERE "provider_message_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "message_log_load_idx" ON "notifications"."message_log" ("load_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "message_log_recipient_idx" ON "notifications"."message_log" ("recipient_ref_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "message_log_provider_request_idx" ON "notifications"."message_log" ("provider_request_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "notifications"."whatsapp_inbound" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "provider" varchar(16) NOT NULL,
        "provider_message_id" varchar(255) NOT NULL,
        "from_phone" varchar(32) NOT NULL,
        "from_user_id" varchar(128),
        "type" varchar(16) NOT NULL,
        "provider_type" varchar(32) NOT NULL,
        "body" text,
        "button_id" varchar(256),
        "button_text" varchar(100),
        "list_row_id" varchar(200),
        "flow_response" jsonb,
        "media" jsonb,
        "context_message_id" varchar(255),
        "matched_message_log_id" uuid,
        "load_id" uuid,
        "load_ref" varchar(64),
        "recipient_ref_id" varchar(64),
        "parsed_values" jsonb,
        "picker_message_log_id" uuid,
        "routing_method" varchar(16) NOT NULL DEFAULT 'none',
        "resolution" varchar(24) NOT NULL DEFAULT 'pending',
        "resolution_note" text,
        "raw" jsonb NOT NULL,
        "received_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "whatsapp_inbound_pk" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "whatsapp_inbound_provider_message_id_unique" ON "notifications"."whatsapp_inbound" ("provider", "provider_message_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "whatsapp_inbound_sender_idx" ON "notifications"."whatsapp_inbound" ("from_phone", "received_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "whatsapp_inbound_load_idx" ON "notifications"."whatsapp_inbound" ("load_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "whatsapp_inbound_resolution_idx" ON "notifications"."whatsapp_inbound" ("resolution")`,
    );
    await queryRunner.query(
      `CREATE INDEX "whatsapp_inbound_picker_idx" ON "notifications"."whatsapp_inbound" ("picker_message_log_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications"."whatsapp_inbound"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications"."message_log"`);
  }
}
