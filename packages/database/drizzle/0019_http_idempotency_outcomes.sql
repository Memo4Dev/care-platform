CREATE TABLE "integration"."idempotency_outcomes" (
  "id" uuid PRIMARY KEY NOT NULL,
  "scope" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "status" text NOT NULL,
 "response_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "integration"."idempotency_outcomes"
  ADD CONSTRAINT "idempotency_outcomes_scope_key_unique" UNIQUE("scope", "idempotency_key");
--> statement-breakpoint
CREATE INDEX "idempotency_outcomes_created_at_idx"
  ON "integration"."idempotency_outcomes" USING btree ("created_at");
