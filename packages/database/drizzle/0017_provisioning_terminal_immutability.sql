CREATE UNIQUE INDEX "platform_tenants_verified_registration_reference_unique" ON "platform"."tenants" ("registration_reference") WHERE "registration_status" = 'VERIFIED' AND "registration_reference" <> 'legacy';--> statement-breakpoint
CREATE OR REPLACE FUNCTION "platform"."reject_registration_snapshot_mutation"() RETURNS trigger AS $$
BEGIN
  IF OLD.registration_reference IS DISTINCT FROM NEW.registration_reference
     OR OLD.registration_status IS DISTINCT FROM NEW.registration_status
     OR OLD.registration_requested_organization_name IS DISTINCT FROM NEW.registration_requested_organization_name
     OR OLD.registration_owner_supabase_subject IS DISTINCT FROM NEW.registration_owner_supabase_subject
     OR OLD.registration_owner_email IS DISTINCT FROM NEW.registration_owner_email
     OR OLD.registration_owner_display_name IS DISTINCT FROM NEW.registration_owner_display_name
     OR OLD.registration_verified_at IS DISTINCT FROM NEW.registration_verified_at THEN
    RAISE EXCEPTION 'verified tenant registration snapshot is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "platform_tenants_registration_snapshot_immutable" BEFORE UPDATE ON "platform"."tenants" FOR EACH ROW EXECUTE FUNCTION "platform"."reject_registration_snapshot_mutation"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "provisioning"."reject_terminal_provisioning_mutation"() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'completed tenant provisioning is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "tenant_provisioning_terminal_immutable" BEFORE UPDATE OR DELETE ON "provisioning"."tenant_provisioning" FOR EACH ROW EXECUTE FUNCTION "provisioning"."reject_terminal_provisioning_mutation"();
