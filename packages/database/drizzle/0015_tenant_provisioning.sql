CREATE SCHEMA "provisioning";--> statement-breakpoint
CREATE TYPE "provisioning"."tenant_provisioning_status" AS ENUM('REQUESTED', 'CREATING_ORGANIZATION', 'CREATING_IDENTITY_DEFAULTS', 'CREATING_BUSINESS_DEFAULTS', 'CREATING_STOREFRONT', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TABLE "provisioning"."tenant_provisioning" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"."organizations"("id") ON DELETE restrict,
  "status" "provisioning"."tenant_provisioning_status" DEFAULT 'REQUESTED' NOT NULL,
  "current_step" text NOT NULL,
  "checkpoints_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_error" text,
  "started_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz,
  "version" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "tenant_provisioning_tenant_unique" UNIQUE("tenant_id"),
  CONSTRAINT "tenant_provisioning_organization_unique" UNIQUE("organization_id"),
  CONSTRAINT "tenant_provisioning_tenant_org_fk" FOREIGN KEY ("tenant_id", "organization_id") REFERENCES "platform"."tenants"("id", "organization_id") ON DELETE restrict,
  CONSTRAINT "tenant_provisioning_completed_at_check" CHECK ("status" <> 'COMPLETED' OR "completed_at" IS NOT NULL)
);--> statement-breakpoint
CREATE INDEX "tenant_provisioning_status_idx" ON "provisioning"."tenant_provisioning" ("status");
