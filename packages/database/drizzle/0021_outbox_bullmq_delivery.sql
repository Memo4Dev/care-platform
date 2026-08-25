ALTER TABLE "integration"."outbox"
  ADD COLUMN "published_at" timestamp with time zone,
  ADD COLUMN "publish_lease_id" uuid,
  ADD COLUMN "publish_lease_expires_at" timestamp with time zone,
  ADD COLUMN "publish_attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN "last_publish_error" text;
--> statement-breakpoint
CREATE INDEX "integration_outbox_relay_claim_idx"
  ON "integration"."outbox" USING btree ("published_at", "publish_lease_expires_at", "occurred_at");
--> statement-breakpoint
ALTER TABLE "integration"."inbox" ADD COLUMN "lease_id" uuid;
