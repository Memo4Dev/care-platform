# ---- Build stage ----
FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.16.1 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json tsconfig.base.json .nvmrc ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
COPY packages/testing/package.json packages/testing/
COPY packages/config/package.json packages/config/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod=false
COPY packages/contracts/ packages/contracts/
COPY packages/database/ packages/database/
COPY packages/testing/ packages/testing/
COPY packages/config/ packages/config/
COPY apps/api/ apps/api/
RUN pnpm --filter @commerce-platform/database build && pnpm --filter @commerce-platform/contracts build && pnpm --filter @commerce-platform/api build

# ---- Production stage ----
FROM node:24-alpine AS production
RUN corepack enable && corepack prepare pnpm@10.16.1 --activate
RUN apk add --no-cache tini curl
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
COPY packages/testing/package.json packages/testing/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/contracts/package.json packages/contracts/package.json
COPY --from=build /app/packages/database/dist packages/database/dist
COPY --from=build /app/packages/database/package.json packages/database/package.json
COPY --from=build /app/packages/database/drizzle packages/database/drizzle
COPY --from=build /app/apps/api/dist apps/api/dist
ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/dist/main.js"]
