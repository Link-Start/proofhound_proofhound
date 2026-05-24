FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/server/package.json apps/server/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile --filter @proofhound/server...

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/server apps/server
RUN pnpm --filter @proofhound/server build
RUN pnpm --filter @proofhound/server deploy --legacy --prod /app/deploy/server

FROM node:24-alpine AS runtime
RUN addgroup -g 1001 -S nodejs && adduser -S nodeapp -u 1001 -G nodejs
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=nodeapp:nodejs /app/deploy/server ./
COPY --from=build --chown=nodeapp:nodejs /app/packages/llm-client/src/assets ./dist/packages/llm-client/src/assets
EXPOSE 4000
USER nodeapp
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT ?? process.env.SERVER_PORT ?? '4000') + '/healthz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/main.js"]
