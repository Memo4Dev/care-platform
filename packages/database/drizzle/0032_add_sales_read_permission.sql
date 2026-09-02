INSERT INTO identity.permissions (id, code, description, created_at)
VALUES (
  gen_random_uuid(),
  'sales.read',
  'Read sale snapshots and sale history within authorized scope.',
  now()
)
ON CONFLICT (code) DO NOTHING;
