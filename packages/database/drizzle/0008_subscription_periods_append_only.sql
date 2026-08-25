CREATE OR REPLACE FUNCTION "subscription"."reject_subscription_period_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'subscription.subscription_periods is append-only'
    USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "subscription_periods_append_only"
BEFORE UPDATE OR DELETE ON "subscription"."subscription_periods"
FOR EACH ROW EXECUTE FUNCTION "subscription"."reject_subscription_period_mutation"();
