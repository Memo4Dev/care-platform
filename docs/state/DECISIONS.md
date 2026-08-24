# Decisions

- Greenfield repository
- pnpm + Turborepo
- NestJS + Fastify
- PostgreSQL + Drizzle
- Redis + BullMQ
- Supabase Auth
- Next.js + React + TypeScript + Tailwind
- Tauri 2 POS, Flutter deferred
- Cloudflare R2
- REST + OpenAPI
- human approval required for push/merge
- all required gates must be green
- M0-001 bootstraps only the root workspace, shared TypeScript config, `packages/config`, and a lightweight `apps/api` shell; framework-specific app scaffolds and quality tooling are deferred to subsequent M0 tasks
- M0-002 establishes the initial runnable quality baseline for the current scaffold using Prettier, ESLint, TypeScript, and Vitest, while keeping broader monorepo orchestration expansion for later tasks
- M0-003 provides local-only Docker Compose services for PostgreSQL and Redis, with persistent volumes and health checks, without introducing application containers
- M0-004 adds a baseline GitHub Actions workflow that installs dependencies and runs format, lint, typecheck, test, and build for the currently bootstrapped workspace
