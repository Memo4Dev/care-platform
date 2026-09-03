CREATE SCHEMA IF NOT EXISTS "customers";

CREATE TABLE IF NOT EXISTS "customers"."business_customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"display_name" text NOT NULL,
	"code" text,
	"phone" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "business_customers_type_check" CHECK ("type" IN ('INDIVIDUAL', 'BUSINESS')),
	CONSTRAINT "business_customers_organization_id_organizations_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "business_customers_org_code_unique"
	ON "customers"."business_customers" USING btree ("organization_id", "code")
	WHERE "code" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "business_customers_tenant_scope_unique"
	ON "customers"."business_customers" USING btree ("id", "organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_customers_organization_id_idx"
	ON "customers"."business_customers" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_customers_org_display_name_idx"
	ON "customers"."business_customers" USING btree ("organization_id", "display_name");
