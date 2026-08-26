CREATE INDEX "branches_organization_id_idx" ON "organization"."branches" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "warehouses_organization_id_idx" ON "organization"."warehouses" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "warehouses_branch_id_idx" ON "organization"."warehouses" USING btree ("branch_id");