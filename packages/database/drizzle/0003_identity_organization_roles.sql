CREATE TABLE "identity"."user_organization_roles" (
  "user_id" uuid NOT NULL,
  "role_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_organization_roles_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
ALTER TABLE "identity"."user_organization_roles" ADD CONSTRAINT "user_organization_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "identity"."user_organization_roles" ADD CONSTRAINT "user_organization_roles_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "identity"."users"("id","organization_id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "identity"."user_organization_roles" ADD CONSTRAINT "user_organization_roles_role_tenant_fk" FOREIGN KEY ("role_id","organization_id") REFERENCES "identity"."roles"("id","organization_id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "user_organization_roles_role_id_idx" ON "identity"."user_organization_roles" USING btree ("role_id");
--> statement-breakpoint
CREATE INDEX "user_organization_roles_organization_id_idx" ON "identity"."user_organization_roles" USING btree ("organization_id");
