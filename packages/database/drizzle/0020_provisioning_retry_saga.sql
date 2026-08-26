CREATE TABLE "integration"."inbox" (
  "event_id" uuid NOT NULL,
  "consumer" text NOT NULL,
  "status" text NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "lease_expires_at" timestamp with time zone,
  CONSTRAINT "integration_inbox_event_consumer_pk" PRIMARY KEY("event_id", "consumer")
);
--> statement-breakpoint
CREATE INDEX "integration_inbox_consumer_status_idx"
  ON "integration"."inbox" USING btree ("consumer", "status");
--> statement-breakpoint
CREATE INDEX "integration_inbox_claim_expiry_idx"
  ON "integration"."inbox" USING btree ("status", "lease_expires_at");
--> statement-breakpoint
CREATE TABLE "provisioning"."retry_requests" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "provisioning_id" uuid,
  "registration_reference" text NOT NULL,
  "idempotency_scope" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "event_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'REQUESTED',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "provisioning_retry_requests_tenant_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE RESTRICT,
  CONSTRAINT "provisioning_retry_requests_process_fk"
    FOREIGN KEY ("provisioning_id") REFERENCES "provisioning"."tenant_provisioning"("id") ON DELETE RESTRICT,
  CONSTRAINT "provisioning_retry_requests_scope_key_unique" UNIQUE("idempotency_scope", "idempotency_key"),
  CONSTRAINT "provisioning_retry_requests_event_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "provisioning_retry_requests_active_tenant_unique"
  ON "provisioning"."retry_requests" USING btree ("tenant_id")
  WHERE "status" = 'REQUESTED';
