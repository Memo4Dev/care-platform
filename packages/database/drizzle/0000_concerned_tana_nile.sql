CREATE SCHEMA "integration";
--> statement-breakpoint
CREATE SCHEMA "organization";
--> statement-breakpoint
CREATE TYPE "organization"."organization_policy_type" AS ENUM('RETURN', 'REFUND', 'PURCHASE', 'ORDER_APPROVAL', 'OFFLINE', 'CREDIT', 'DELIVERY', 'INVENTORY');--> statement-breakpoint
CREATE TYPE "organization"."organization_status" AS ENUM('ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TABLE "integration"."outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"correlation_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization"."branches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "branches_org_code_unique" UNIQUE("organization_id","code"),
	CONSTRAINT "branches_tenant_scope_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "organization"."organization_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"policy_type" "organization"."organization_policy_type" NOT NULL,
	"value_json" jsonb NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_policies_org_version_unique" UNIQUE("organization_id","version")
);
--> statement-breakpoint
CREATE TABLE "organization"."organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" "organization"."organization_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization"."warehouses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "warehouses_org_branch_code_unique" UNIQUE("organization_id","branch_id","code")
);
--> statement-breakpoint
ALTER TABLE "organization"."branches" ADD CONSTRAINT "branches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization"."organization_policies" ADD CONSTRAINT "organization_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization"."warehouses" ADD CONSTRAINT "warehouses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization"."warehouses" ADD CONSTRAINT "warehouses_branch_tenant_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "organization"."branches"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_outbox_occurred_at_idx" ON "integration"."outbox" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "organization_policies_latest_idx" ON "organization"."organization_policies" USING btree ("organization_id","policy_type","version" desc);