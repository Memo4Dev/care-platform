-- Add M2 catalog and pricing permission codes.
-- Fixed ids follow the existing sequence (000000000024–000000000031);
-- ON CONFLICT DO NOTHING keeps re-deliveries safe.
INSERT INTO "identity"."permissions" ("id", "code", "description") VALUES
	('018f0000-0000-7000-8000-000000000024', 'catalog.view', 'View products, variants, categories, units, and barcodes.'),
	('018f0000-0000-7000-8000-000000000025', 'catalog.create', 'Create products, variants, categories, units, conversions, and barcodes.'),
	('018f0000-0000-7000-8000-000000000026', 'catalog.edit', 'Update product, variant, category, unit, and conversion metadata.'),
	('018f0000-0000-7000-8000-000000000027', 'catalog.delete', 'Deactivate or discontinue catalog items.'),
	('018f0000-0000-7000-8000-000000000028', 'pricing.view', 'View price books, entries, promotions, coupons, and snapshots.'),
	('018f0000-0000-7000-8000-000000000029', 'pricing.create', 'Create price books, entries, promotions, and coupons.'),
	('018f0000-0000-7000-8000-000000000030', 'pricing.edit', 'Update price book entries, promotion rules, and coupon terms.'),
	('018f0000-0000-7000-8000-000000000031', 'pricing.delete', 'Deactivate price books, promotions, and coupons.')
ON CONFLICT ("code") DO NOTHING;
