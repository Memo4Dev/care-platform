CREATE TABLE "identity"."initial_owner_assignments" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity"."initial_owner_assignments" ADD CONSTRAINT "initial_owner_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."initial_owner_assignments" ADD CONSTRAINT "initial_owner_assignments_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "identity"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."initial_owner_assignments" ADD CONSTRAINT "initial_owner_assignments_role_tenant_fk" FOREIGN KEY ("role_id","organization_id") REFERENCES "identity"."roles"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "initial_owner_assignments_user_id_idx" ON "identity"."initial_owner_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "initial_owner_assignments_role_id_idx" ON "identity"."initial_owner_assignments" USING btree ("role_id");