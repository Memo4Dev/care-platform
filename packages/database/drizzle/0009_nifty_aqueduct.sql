CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE TYPE "platform"."tenant_status" AS ENUM('REGISTERED', 'ACTIVE', 'SUSPENDED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "platform"."provisioning_status" AS ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "platform"."support_session_status" AS ENUM('REQUESTED', 'ACTIVE', 'ENDED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "platform"."tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" "platform"."tenant_status" DEFAULT 'REGISTERED' NOT NULL,
	"provisioning_status" "platform"."provisioning_status" DEFAULT 'PENDING' NOT NULL,
	"subscription_id" uuid,
	"subscription_version" text,
	"suspended_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "platform_tenants_organization_unique" UNIQUE("organization_id"),
	CONSTRAINT "platform_tenants_subscription_unique" UNIQUE("subscription_id"),
	CONSTRAINT "platform_tenants_suspend_reason_check" CHECK ("platform"."tenants"."status" <> 'SUSPENDED' OR "platform"."tenants"."suspended_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "platform"."support_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" "platform"."support_session_status" DEFAULT 'REQUESTED' NOT NULL,
	"reason" text NOT NULL,
	"requested_by" text NOT NULL,
	"started_by" text,
	"ended_by" text,
	"requested_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "support_sessions_tenant_organization_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "support_sessions_expiry_after_request_check" CHECK ("platform"."support_sessions"."expires_at" > "platform"."support_sessions"."requested_at")
);
--> statement-breakpoint
ALTER TABLE "platform"."tenants" ADD CONSTRAINT "tenants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."tenants" ADD CONSTRAINT "tenants_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "subscription"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."support_sessions" ADD CONSTRAINT "support_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."support_sessions" ADD CONSTRAINT "support_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_tenants_status_idx" ON "platform"."tenants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "support_sessions_tenant_status_expiry_idx" ON "platform"."support_sessions" USING btree ("tenant_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "support_sessions_organization_status_expiry_idx" ON "platform"."support_sessions" USING btree ("organization_id","status","expires_at");