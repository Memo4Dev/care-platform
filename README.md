# Commerce Platform Monorepo

This repository is bootstrapped as a `pnpm` + Turborepo workspace.

## Milestone status

M0 is complete.

Implemented:

- `M0-001` root workspace configuration
- `M0-001` shared TypeScript baseline
- `M0-001` shared config package for TypeScript presets
- `M0-001` initial API shell workspace
- `M0-001` explicit placeholders for later apps and packages
- `M0-002` baseline formatting, lint, typecheck, and unit-test wiring for the current workspace
- `M0-003` local Docker services baseline for PostgreSQL and Redis
- `M0-004` GitHub Actions CI baseline for format, lint, typecheck, test, and build
- `M0-005` minimal real NestJS + Fastify modular-monolith API shell with `GET /health`

## API shell (M0-005)

`apps/api` now contains:

- NestJS bootstrap (`src/main.ts`)
- Fastify adapter configuration
- root `AppModule` (`src/app.module.ts`)
- modular baseline (`src/modules/app-shell`, `src/modules/health`, `src/common`)
- shell-safe health endpoint: `GET /health`
- unit and integration-light tests that run locally on macOS without Docker

Current health response shape:

```json
{
  "status": "ok",
  "service": "api-shell",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

## Notes

- Turborepo remains the monorepo orchestrator baseline for the repository.
- The current quality scripts target the bootstrapped API shell directly so they remain runnable before broader workspace scaffolding is added.
- Local Docker services intentionally cover only PostgreSQL and Redis at this stage.

## Local infrastructure

1. Copy `.env.local.example` to `.env.local`.
2. Adjust local credentials/ports if needed.
3. Start services with `scripts/dev-services.sh up`.
4. Inspect status with `scripts/dev-services.sh ps`.
5. Stop services with `scripts/dev-services.sh down`.

Services started by `docker-compose.local.yml`:

- PostgreSQL 17
- Redis 7

## Workspace layout

- `apps/api` — initial TypeScript API workspace shell
- `apps/admin` — placeholder for future Next.js admin app
- `apps/platform-admin` — placeholder for future Next.js platform admin app
- `apps/storefront` — placeholder for future Next.js storefront app
- `apps/pos` — placeholder for future Tauri POS app
- `packages/config` — shared configuration package
- other `packages/*` — reserved placeholders for later milestones
