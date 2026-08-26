/**
 * Unit-test environment defaults.
 *
 * The API shell wires DatabaseModule eagerly, and its provider validates
 * DATABASE_URL at construction (fail-fast by design). Unit tests never open
 * connections — the pg pool connects lazily — so a syntactically valid dummy
 * URL is enough to let AppModule boot without real infrastructure. Set a real
 * URL in the environment to override.
 */
process.env.DATABASE_URL ??= 'postgresql://unit-test:unit-test@127.0.0.1:5/unit_test';
