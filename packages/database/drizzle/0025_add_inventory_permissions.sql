-- M3-004: Add inventory.create permission code.
-- inventory.view (0009), inventory.adjust (0010), inventory.transfer (0011)
-- were already seeded in 0002_dark_shard.sql; inventory.create is new.
-- ON CONFLICT DO NOTHING keeps re-deliveries safe.
INSERT INTO "identity"."permissions" ("id", "code", "description") VALUES
	('018f0000-0000-7000-8000-000000000032', 'inventory.create', 'Create reservations, allocations, and receive stock.')
ON CONFLICT ("code") DO NOTHING;
