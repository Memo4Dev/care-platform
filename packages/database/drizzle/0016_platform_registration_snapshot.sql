ALTER TABLE "platform"."tenants" ADD COLUMN "registration_reference" text NOT NULL DEFAULT 'legacy';--> statement-breakpoint
ALTER TABLE "platform"."tenants" ADD COLUMN "registration_status" text NOT NULL DEFAULT 'LEGACY';--> statement-breakpoint
ALTER TABLE "platform"."tenants" ADD COLUMN "registration_requested_organization_name" text NOT NULL DEFAULT 'legacy';--> statement-breakpoint
ALTER TABLE "platform"."tenants" ADD COLUMN "registration_owner_supabase_subject" text NOT NULL DEFAULT 'legacy';--> statement-breakpoint
ALTER TABLE "platform"."tenants" ADD COLUMN "registration_owner_email" text NOT NULL DEFAULT 'legacy';--> statement-breakpoint
ALTER TABLE "platform"."tenants" ADD COLUMN "registration_owner_display_name" text NOT NULL DEFAULT 'legacy';--> statement-breakpoint
ALTER TABLE "platform"."tenants" ADD COLUMN "registration_verified_at" timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
UPDATE "platform"."tenants" SET "registration_status" = 'LEGACY' WHERE "registration_reference" = 'legacy';
