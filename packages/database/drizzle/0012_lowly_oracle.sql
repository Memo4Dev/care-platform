ALTER TABLE "platform"."tenants" ALTER COLUMN "subscription_version" SET DATA TYPE integer USING "subscription_version"::integer;
