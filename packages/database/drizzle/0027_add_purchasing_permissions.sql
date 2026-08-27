-- M4-001: Add purchasing permission codes.
-- Legacy migration 0002 seeded `purchase.create` / `purchase.approve` (different naming).
-- The new `purchasing.*` codes match IDENTITY_CONTRACTS.PERMISSION_CODES.
-- ON CONFLICT DO NOTHING keeps re-deliveries safe.
INSERT INTO "identity"."permissions" ("id", "code", "description") VALUES
	('018f0000-0000-7000-8000-000000000033', 'purchasing.read', 'Read purchasing data (suppliers, purchase orders, goods receipts).'),
	('018f0000-0000-7000-8000-000000000034', 'purchasing.write', 'Create and modify purchasing data.'),
	('018f0000-0000-7000-8000-000000000035', 'purchasing.approve', 'Approve purchase orders.'),
	('018f0000-0000-7000-8000-000000000036', 'purchasing.receive', 'Confirm goods receipts.')
ON CONFLICT ("code") DO NOTHING;
