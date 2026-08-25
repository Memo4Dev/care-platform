CREATE TYPE "platform"."principal_status" AS ENUM('ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TABLE "platform"."principals" ("id" uuid PRIMARY KEY NOT NULL, "supabase_user_id" text NOT NULL, "status" "platform"."principal_status" DEFAULT 'ACTIVE' NOT NULL, "created_at" timestamptz DEFAULT now() NOT NULL, "updated_at" timestamptz DEFAULT now() NOT NULL, "version" integer DEFAULT 1 NOT NULL, CONSTRAINT "platform_principals_supabase_user_unique" UNIQUE("supabase_user_id"));--> statement-breakpoint
CREATE TABLE "platform"."roles" ("id" uuid PRIMARY KEY NOT NULL, "code" text NOT NULL, "name" text NOT NULL, "created_at" timestamptz DEFAULT now() NOT NULL, "updated_at" timestamptz DEFAULT now() NOT NULL, CONSTRAINT "platform_roles_code_unique" UNIQUE("code"));--> statement-breakpoint
CREATE TABLE "platform"."capabilities" ("id" uuid PRIMARY KEY NOT NULL, "code" text NOT NULL, "description" text NOT NULL, CONSTRAINT "platform_capabilities_code_unique" UNIQUE("code"));--> statement-breakpoint
CREATE TABLE "platform"."role_capabilities" ("role_id" uuid NOT NULL REFERENCES "platform"."roles"("id") ON DELETE cascade, "capability_id" uuid NOT NULL REFERENCES "platform"."capabilities"("id") ON DELETE restrict, CONSTRAINT "platform_role_capabilities_unique" UNIQUE("role_id", "capability_id"));--> statement-breakpoint
CREATE TABLE "platform"."principal_roles" ("principal_id" uuid NOT NULL REFERENCES "platform"."principals"("id") ON DELETE cascade, "role_id" uuid NOT NULL REFERENCES "platform"."roles"("id") ON DELETE restrict, CONSTRAINT "platform_principal_roles_unique" UNIQUE("principal_id", "role_id"));--> statement-breakpoint
CREATE INDEX "platform_role_capabilities_capability_idx" ON "platform"."role_capabilities" ("capability_id");--> statement-breakpoint
CREATE INDEX "platform_principal_roles_role_idx" ON "platform"."principal_roles" ("role_id");--> statement-breakpoint
INSERT INTO "platform"."roles" ("id", "code", "name") VALUES
  ('00000000-0000-7000-8000-000000000001', 'PLATFORM_OWNER', 'Platform Owner'),
  ('00000000-0000-7000-8000-000000000002', 'PLATFORM_SUPPORT', 'Platform Support'),
  ('00000000-0000-7000-8000-000000000003', 'BILLING_ADMIN', 'Billing Admin');--> statement-breakpoint
INSERT INTO "platform"."principals" ("id", "supabase_user_id") VALUES ('00000000-0000-7000-8000-000000000021', 'system:support-expiry');--> statement-breakpoint
INSERT INTO "platform"."capabilities" ("id", "code", "description") VALUES
  ('00000000-0000-7000-8000-000000000011', 'tenant.view', 'View platform tenant metadata'),
  ('00000000-0000-7000-8000-000000000012', 'tenant.suspend', 'Suspend and manage platform tenant lifecycle'),
  ('00000000-0000-7000-8000-000000000013', 'subscription.change', 'Change subscriptions'),
  ('00000000-0000-7000-8000-000000000014', 'entitlement.override', 'Manage entitlement overrides'),
  ('00000000-0000-7000-8000-000000000015', 'support.session', 'Manage explicit support sessions'),
  ('00000000-0000-7000-8000-000000000016', 'platform.audit', 'Read platform audit data');--> statement-breakpoint
INSERT INTO "platform"."role_capabilities" ("role_id", "capability_id") VALUES
  ('00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000011'),
  ('00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000012'),
  ('00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000013'),
  ('00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000014'),
  ('00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000015'),
  ('00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000016'),
  ('00000000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-000000000011'),
  ('00000000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-000000000015'),
  ('00000000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-000000000016'),
  ('00000000-0000-7000-8000-000000000003', '00000000-0000-7000-8000-000000000011'),
  ('00000000-0000-7000-8000-000000000003', '00000000-0000-7000-8000-000000000013'),
  ('00000000-0000-7000-8000-000000000003', '00000000-0000-7000-8000-000000000014'),
  ('00000000-0000-7000-8000-000000000003', '00000000-0000-7000-8000-000000000016');--> statement-breakpoint
ALTER TABLE "subscription"."subscriptions" ADD CONSTRAINT "subscriptions_id_organization_unique" UNIQUE("id", "organization_id");--> statement-breakpoint
ALTER TABLE "platform"."tenants" DROP CONSTRAINT "tenants_subscription_id_subscriptions_id_fk";--> statement-breakpoint
ALTER TABLE "platform"."tenants" ADD CONSTRAINT "platform_tenants_subscription_organization_fk" FOREIGN KEY ("subscription_id", "organization_id") REFERENCES "subscription"."subscriptions"("id", "organization_id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "platform"."support_sessions" ADD COLUMN "requested_by_platform_user_id" uuid REFERENCES "platform"."principals"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "platform"."support_sessions" ADD COLUMN "started_by_platform_user_id" uuid REFERENCES "platform"."principals"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "platform"."support_sessions" ADD COLUMN "ended_by_platform_user_id" uuid REFERENCES "platform"."principals"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "platform"."support_sessions" ALTER COLUMN "requested_by_platform_user_id" SET NOT NULL;
