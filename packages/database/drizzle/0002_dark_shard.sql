CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE TYPE "identity"."user_status" AS ENUM('ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TABLE "identity"."branch_access" (
	"user_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_access_pk" PRIMARY KEY("user_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "identity"."permissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "identity"."role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "role_permissions_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "identity"."roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "roles_org_code_unique" UNIQUE("organization_id","code"),
	CONSTRAINT "roles_tenant_scope_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "identity"."user_branch_roles" (
	"user_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_branch_roles_pk" PRIMARY KEY("user_id","branch_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "identity"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"supabase_user_id" text,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"status" "identity"."user_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_supabase_user_id_unique" UNIQUE("supabase_user_id"),
	CONSTRAINT "users_tenant_scope_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "identity"."branch_access" ADD CONSTRAINT "branch_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."branch_access" ADD CONSTRAINT "branch_access_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "identity"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."branch_access" ADD CONSTRAINT "branch_access_branch_tenant_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "organization"."branches"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "identity"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "identity"."permissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user_branch_roles" ADD CONSTRAINT "user_branch_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user_branch_roles" ADD CONSTRAINT "user_branch_roles_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "identity"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user_branch_roles" ADD CONSTRAINT "user_branch_roles_branch_tenant_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "organization"."branches"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user_branch_roles" ADD CONSTRAINT "user_branch_roles_role_tenant_fk" FOREIGN KEY ("role_id","organization_id") REFERENCES "identity"."roles"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branch_access_branch_id_idx" ON "identity"."branch_access" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "branch_access_organization_id_idx" ON "identity"."branch_access" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "role_permissions_permission_id_idx" ON "identity"."role_permissions" USING btree ("permission_id");--> statement-breakpoint
CREATE INDEX "roles_organization_id_idx" ON "identity"."roles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "user_branch_roles_branch_id_idx" ON "identity"."user_branch_roles" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "user_branch_roles_role_id_idx" ON "identity"."user_branch_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "user_branch_roles_organization_id_idx" ON "identity"."user_branch_roles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "users_organization_id_idx" ON "identity"."users" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_unique" ON "identity"."users" USING btree (lower("email"));
--> statement-breakpoint
-- Idempotent seed of the GLOBAL permission catalog (docs/architecture/
-- 72-authorization-matrix.md capability matrix plus sales.edit from
-- docs/architecture/11-identity-access.md). Fixed ids keep the catalog
-- deterministic across environments; ON CONFLICT DO NOTHING makes re-runs
-- and re-deliveries no-ops.
INSERT INTO "identity"."permissions" ("id", "code", "description") VALUES
	('018f0000-0000-7000-8000-000000000001', 'sales.create', 'Create POS and counter sales.'),
	('018f0000-0000-7000-8000-000000000002', 'sales.edit', 'Edit a sale before completion.'),
	('018f0000-0000-7000-8000-000000000003', 'sales.cancel', 'Cancel a sale.'),
	('018f0000-0000-7000-8000-000000000004', 'price.override', 'Override a computed price.'),
	('018f0000-0000-7000-8000-000000000005', 'discount.override', 'Apply discounts beyond normal limits.'),
	('018f0000-0000-7000-8000-000000000006', 'order.approve', 'Approve customer orders.'),
	('018f0000-0000-7000-8000-000000000007', 'refund.create', 'Create refunds for completed sales.'),
	('018f0000-0000-7000-8000-000000000008', 'refund.override', 'Override refund rules and limits.'),
	('018f0000-0000-7000-8000-000000000009', 'inventory.view', 'View stock levels and inventory positions.'),
	('018f0000-0000-7000-8000-000000000010', 'inventory.adjust', 'Post stock adjustments.'),
	('018f0000-0000-7000-8000-000000000011', 'inventory.transfer', 'Create and move stock transfers between branches.'),
	('018f0000-0000-7000-8000-000000000012', 'purchase.create', 'Create purchase orders.'),
	('018f0000-0000-7000-8000-000000000013', 'purchase.approve', 'Approve purchase orders.'),
	('018f0000-0000-7000-8000-000000000014', 'credit.use', 'Sell on customer credit accounts.'),
	('018f0000-0000-7000-8000-000000000015', 'credit.override', 'Override credit limits and holds.'),
	('018f0000-0000-7000-8000-000000000016', 'offline.resolve', 'Resolve offline sync conflicts.'),
	('018f0000-0000-7000-8000-000000000017', 'cash.reconcile', 'Reconcile cash sessions.'),
	('018f0000-0000-7000-8000-000000000018', 'delivery.manage', 'Manage deliveries and delivery assignments.'),
	('018f0000-0000-7000-8000-000000000019', 'users.manage', 'Manage users, roles and branch access.'),
	('018f0000-0000-7000-8000-000000000020', 'roles.manage', 'Create and rename organization roles.'),
	('018f0000-0000-7000-8000-000000000021', 'permissions.manage', 'Change permissions assigned to organization roles.'),
	('018f0000-0000-7000-8000-000000000022', 'role-grants.manage', 'Assign and revoke organization and branch roles.'),
	('018f0000-0000-7000-8000-000000000023', 'branch-access.manage', 'Assign and revoke branch access.')
ON CONFLICT ("code") DO NOTHING;
