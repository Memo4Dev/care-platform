ALTER TABLE "platform"."tenants" ADD CONSTRAINT "platform_tenants_id_organization_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "platform"."support_sessions" ADD CONSTRAINT "support_sessions_tenant_organization_fk" FOREIGN KEY ("tenant_id","organization_id") REFERENCES "platform"."tenants"("id","organization_id") ON DELETE restrict ON UPDATE no action;
