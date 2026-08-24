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
