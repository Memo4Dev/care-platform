CREATE SCHEMA IF NOT EXISTS "catalog";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "pricing";
--> statement-breakpoint
CREATE TYPE "catalog"."product_status" AS ENUM('ACTIVE', 'DRAFT', 'DISCONTINUED');--> statement-breakpoint
CREATE TYPE "catalog"."variant_status" AS ENUM('ACTIVE', 'DRAFT', 'DISCONTINUED');--> statement-breakpoint
CREATE TYPE "pricing"."channel" AS ENUM('POS', 'ONLINE', 'MOBILE', 'WHOLESALE');--> statement-breakpoint
CREATE TYPE "pricing"."coupon_type" AS ENUM('PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING');--> statement-breakpoint
CREATE TYPE "pricing"."price_type" AS ENUM('CASH', 'WHOLESALE', 'CREDIT', 'ONLINE');--> statement-breakpoint
CREATE TYPE "pricing"."promotion_target" AS ENUM('PRODUCT', 'VARIANT', 'CATEGORY', 'ORDER');--> statement-breakpoint
CREATE TYPE "pricing"."promotion_type" AS ENUM('PERCENTAGE', 'FIXED_AMOUNT', 'BUY_X_GET_Y');--> statement-breakpoint
CREATE TABLE "catalog"."barcodes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"barcode" text NOT NULL,
	"packaging_definition_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "barcodes_org_barcode_unique" UNIQUE("organization_id","barcode")
);
--> statement-breakpoint
CREATE TABLE "catalog"."categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "categories_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "catalog"."packaging_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit_id" uuid NOT NULL,
	"parent_id" uuid,
	"factor" numeric(18, 8) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "packaging_definitions_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "catalog"."product_variants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"barcode" text,
	"base_unit_id" uuid NOT NULL,
	"category_id" uuid,
	"status" "catalog"."variant_status" DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "product_variants_org_sku_unique" UNIQUE("organization_id","sku"),
	CONSTRAINT "product_variants_org_barcode_unique" UNIQUE("organization_id","barcode")
);
--> statement-breakpoint
CREATE TABLE "catalog"."products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "catalog"."product_status" DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "products_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "catalog"."unit_conversions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"from_unit_id" uuid NOT NULL,
	"to_unit_id" uuid NOT NULL,
	"factor" numeric(18, 8) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_conversions_org_from_to_unique" UNIQUE("organization_id","from_unit_id","to_unit_id")
);
--> statement-breakpoint
CREATE TABLE "catalog"."unit_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"is_base_unit" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "unit_definitions_org_name_unique" UNIQUE("organization_id","name"),
	CONSTRAINT "unit_definitions_org_symbol_unique" UNIQUE("organization_id","symbol")
);
--> statement-breakpoint
CREATE TABLE "pricing"."coupons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"type" "pricing"."coupon_type" NOT NULL,
	"value" numeric(18, 4) NOT NULL,
	"promotion_id" uuid,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"min_order_amount" numeric(18, 4),
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "coupons_org_code_unique" UNIQUE("organization_id","code")
);
--> statement-breakpoint
CREATE TABLE "pricing"."price_books" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "price_books_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "pricing"."price_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"price_book_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"price_type" "pricing"."price_type" NOT NULL,
	"channel" "pricing"."channel" DEFAULT 'POS' NOT NULL,
	"branch_id" uuid,
	"amount" numeric(18, 4) NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "price_entries_book_variant_unit_type_channel_branch_effunique" UNIQUE("price_book_id","variant_id","unit_id","price_type","channel","branch_id","effective_from")
);
--> statement-breakpoint
CREATE TABLE "pricing"."price_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"price_type" "pricing"."price_type" NOT NULL,
	"channel" "pricing"."channel" DEFAULT 'POS' NOT NULL,
	"branch_id" uuid,
	"amount" numeric(18, 4) NOT NULL,
	"quantity" numeric(18, 8) NOT NULL,
	"discount_amount" numeric(18, 4) DEFAULT '0',
	"promotion_id" uuid,
	"coupon_id" uuid,
	"snapshot_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing"."promotions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" "pricing"."promotion_type" NOT NULL,
	"target" "pricing"."promotion_target" NOT NULL,
	"value" numeric(18, 4) NOT NULL,
	"min_quantity" integer,
	"max_quantity" integer,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "promotions_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_id_org_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "catalog"."product_variants" ADD CONSTRAINT "product_variants_id_org_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "catalog"."categories" ADD CONSTRAINT "categories_id_org_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "catalog"."unit_definitions" ADD CONSTRAINT "unit_definitions_id_org_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "pricing"."price_books" ADD CONSTRAINT "price_books_id_org_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "pricing"."promotions" ADD CONSTRAINT "promotions_id_org_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "catalog"."barcodes" ADD CONSTRAINT "barcodes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."barcodes" ADD CONSTRAINT "barcodes_variant_tenant_fk" FOREIGN KEY ("variant_id","organization_id") REFERENCES "catalog"."product_variants"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."categories" ADD CONSTRAINT "categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."categories" ADD CONSTRAINT "categories_parent_tenant_fk" FOREIGN KEY ("parent_id","organization_id") REFERENCES "catalog"."categories"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."packaging_definitions" ADD CONSTRAINT "packaging_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."packaging_definitions" ADD CONSTRAINT "packaging_definitions_unit_tenant_fk" FOREIGN KEY ("unit_id","organization_id") REFERENCES "catalog"."unit_definitions"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."product_variants" ADD CONSTRAINT "product_variants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."product_variants" ADD CONSTRAINT "product_variants_product_tenant_fk" FOREIGN KEY ("product_id","organization_id") REFERENCES "catalog"."products"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."product_variants" ADD CONSTRAINT "product_variants_unit_tenant_fk" FOREIGN KEY ("base_unit_id","organization_id") REFERENCES "catalog"."unit_definitions"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."product_variants" ADD CONSTRAINT "product_variants_category_tenant_fk" FOREIGN KEY ("category_id","organization_id") REFERENCES "catalog"."categories"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."unit_conversions" ADD CONSTRAINT "unit_conversions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."unit_conversions" ADD CONSTRAINT "unit_conversions_from_unit_tenant_fk" FOREIGN KEY ("from_unit_id","organization_id") REFERENCES "catalog"."unit_definitions"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."unit_conversions" ADD CONSTRAINT "unit_conversions_to_unit_tenant_fk" FOREIGN KEY ("to_unit_id","organization_id") REFERENCES "catalog"."unit_definitions"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."unit_definitions" ADD CONSTRAINT "unit_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."coupons" ADD CONSTRAINT "coupons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."coupons" ADD CONSTRAINT "coupons_promotion_tenant_fk" FOREIGN KEY ("promotion_id","organization_id") REFERENCES "pricing"."promotions"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."price_books" ADD CONSTRAINT "price_books_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."price_entries" ADD CONSTRAINT "price_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."price_entries" ADD CONSTRAINT "price_entries_price_book_tenant_fk" FOREIGN KEY ("price_book_id","organization_id") REFERENCES "pricing"."price_books"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."price_entries" ADD CONSTRAINT "price_entries_variant_tenant_fk" FOREIGN KEY ("variant_id","organization_id") REFERENCES "catalog"."product_variants"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."price_snapshots" ADD CONSTRAINT "price_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing"."promotions" ADD CONSTRAINT "promotions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "barcodes_organization_id_idx" ON "catalog"."barcodes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "barcodes_variant_id_idx" ON "catalog"."barcodes" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "barcodes_barcode_idx" ON "catalog"."barcodes" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "categories_organization_id_idx" ON "catalog"."categories" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "categories_parent_id_idx" ON "catalog"."categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "packaging_definitions_organization_id_idx" ON "catalog"."packaging_definitions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "product_variants_organization_id_idx" ON "catalog"."product_variants" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "product_variants_product_id_idx" ON "catalog"."product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_variants_category_id_idx" ON "catalog"."product_variants" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_organization_id_idx" ON "catalog"."products" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "catalog"."products" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "unit_conversions_organization_id_idx" ON "catalog"."unit_conversions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "unit_conversions_from_unit_idx" ON "catalog"."unit_conversions" USING btree ("from_unit_id");--> statement-breakpoint
CREATE INDEX "unit_conversions_to_unit_idx" ON "catalog"."unit_conversions" USING btree ("to_unit_id");--> statement-breakpoint
CREATE INDEX "unit_definitions_organization_id_idx" ON "catalog"."unit_definitions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "coupons_organization_id_idx" ON "pricing"."coupons" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "coupons_active_code_idx" ON "pricing"."coupons" USING btree ("organization_id","is_active","code");--> statement-breakpoint
CREATE INDEX "price_books_organization_id_idx" ON "pricing"."price_books" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "price_entries_organization_id_idx" ON "pricing"."price_entries" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "price_entries_price_book_id_idx" ON "pricing"."price_entries" USING btree ("price_book_id");--> statement-breakpoint
CREATE INDEX "price_entries_variant_id_idx" ON "pricing"."price_entries" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "price_entries_lookup_idx" ON "pricing"."price_entries" USING btree ("price_book_id","variant_id","unit_id","price_type","channel","effective_from");--> statement-breakpoint
CREATE INDEX "price_snapshots_organization_id_idx" ON "pricing"."price_snapshots" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "price_snapshots_source_idx" ON "pricing"."price_snapshots" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "price_snapshots_variant_idx" ON "pricing"."price_snapshots" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "promotions_organization_id_idx" ON "pricing"."promotions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "promotions_active_dates_idx" ON "pricing"."promotions" USING btree ("organization_id","is_active","start_date","end_date");
