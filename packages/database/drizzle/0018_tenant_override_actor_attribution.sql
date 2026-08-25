ALTER TABLE "entitlements"."tenant_overrides"
  ADD COLUMN "actor_type" text,
  ADD COLUMN "actor_id" text,
  ADD COLUMN "correlation_id" text;

UPDATE "entitlements"."tenant_overrides"
SET
  "actor_type" = 'SYSTEM_SERVICE',
  "actor_id" = 'SYSTEM:legacy-tenant-override-migration',
  "correlation_id" = 'MIGRATED-0018'
WHERE "actor_type" IS NULL;

ALTER TABLE "entitlements"."tenant_overrides"
  ALTER COLUMN "granted_by" DROP NOT NULL,
  ALTER COLUMN "actor_type" SET NOT NULL,
  ALTER COLUMN "actor_id" SET NOT NULL,
  ALTER COLUMN "correlation_id" SET NOT NULL;

CREATE INDEX "tenant_overrides_actor_idx"
  ON "entitlements"."tenant_overrides" USING btree ("actor_type", "actor_id");

CREATE OR REPLACE FUNCTION "entitlements"."validate_tenant_override_actor"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.actor_type = 'PLATFORM_USER' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "platform"."principals" p
      WHERE p.id::text = NEW.actor_id AND p.status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'tenant override PLATFORM_USER actor must be an active platform principal'
        USING ERRCODE = '23503';
    END IF;
  ELSIF NEW.actor_type = 'SYSTEM_SERVICE' THEN
    IF NEW.actor_id NOT LIKE 'SYSTEM:%' THEN
      RAISE EXCEPTION 'tenant override SYSTEM_SERVICE actor must be a server identifier'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'tenant override actor type is not permitted'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tenant_overrides_validate_actor"
  BEFORE INSERT OR UPDATE OF "actor_type", "actor_id"
  ON "entitlements"."tenant_overrides"
  FOR EACH ROW
  EXECUTE FUNCTION "entitlements"."validate_tenant_override_actor"();
