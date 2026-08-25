CREATE SCHEMA "subscription";
--> statement-breakpoint
CREATE TYPE "subscription"."billing_cycle" AS ENUM('MONTHLY', 'YEARLY');--> statement-breakpoint
CREATE TYPE "subscription"."subscription_status" AS ENUM('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "subscription"."subscription_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subscription_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" "subscription"."subscription_status" NOT NULL,
	"amount" numeric(18, 4),
	"currency" text,
	"billing_reference" text,
	"effective_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_periods_subscription_effective_unique" UNIQUE("subscription_id","effective_at"),
	CONSTRAINT "subscription_periods_period_valid" CHECK ("subscription"."subscription_periods"."period_end" > "subscription"."subscription_periods"."period_start")
);
--> statement-breakpoint
CREATE TABLE "subscription"."subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "subscription"."subscription_status" NOT NULL,
	"billing_cycle" "subscription"."billing_cycle" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"billing_provider" text,
	"billing_provider_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "subscriptions_period_valid" CHECK ("subscription"."subscriptions"."current_period_end" > "subscription"."subscriptions"."current_period_start")
);
--> statement-breakpoint
ALTER TABLE "subscription"."subscription_periods" ADD CONSTRAINT "subscription_periods_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "subscription"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription"."subscription_periods" ADD CONSTRAINT "subscription_periods_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "entitlements"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription"."subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription"."subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "entitlements"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_periods_subscription_effective_idx" ON "subscription"."subscription_periods" USING btree ("subscription_id","effective_at");--> statement-breakpoint
CREATE INDEX "subscriptions_organization_status_period_end_idx" ON "subscription"."subscriptions" USING btree ("organization_id","status","current_period_end");--> statement-breakpoint
CREATE INDEX "subscriptions_plan_id_idx" ON "subscription"."subscriptions" USING btree ("plan_id");
