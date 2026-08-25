CREATE SCHEMA "entitlements";
--> statement-breakpoint
CREATE TYPE "entitlements"."plan_status" AS ENUM('DRAFT', 'ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TABLE "entitlements"."plan_entitlements" (
	"plan_id" uuid NOT NULL,
	"entitlement_code" text NOT NULL,
	"value_json" jsonb NOT NULL,
	CONSTRAINT "plan_entitlements_pk" PRIMARY KEY("plan_id","entitlement_code")
);
--> statement-breakpoint
CREATE TABLE "entitlements"."plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" "entitlements"."plan_status" DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "entitlements"."tenant_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"entitlement_code" text NOT NULL,
	"value_json" jsonb NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"reason" text NOT NULL,
	"granted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_overrides_effective_window_valid" CHECK (("entitlements"."tenant_overrides"."effective_to" is null or "entitlements"."tenant_overrides"."effective_to" > "entitlements"."tenant_overrides"."effective_from"))
);
--> statement-breakpoint
ALTER TABLE "entitlements"."plan_entitlements" ADD CONSTRAINT "plan_entitlements_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "entitlements"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements"."tenant_overrides" ADD CONSTRAINT "tenant_overrides_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements"."tenant_overrides" ADD CONSTRAINT "tenant_overrides_granted_by_tenant_fk" FOREIGN KEY ("granted_by","organization_id") REFERENCES "identity"."users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_entitlements_code_idx" ON "entitlements"."plan_entitlements" USING btree ("entitlement_code");--> statement-breakpoint
CREATE INDEX "tenant_overrides_organization_code_window_idx" ON "entitlements"."tenant_overrides" USING btree ("organization_id","entitlement_code","effective_from");--> statement-breakpoint
CREATE INDEX "tenant_overrides_granted_by_idx" ON "entitlements"."tenant_overrides" USING btree ("granted_by");