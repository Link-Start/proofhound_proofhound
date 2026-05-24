FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile --filter @proofhound/worker...

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/worker apps/worker
RUN pnpm --filter @proofhound/worker build
RUN pnpm --filter @proofhound/worker deploy --legacy --prod /app/deploy/worker

FROM node:24-alpine AS runtime
RUN addgroup -g 1001 -S nodejs && adduser -S nodeapp -u 1001 -G nodejs
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=nodeapp:nodejs /app/deploy/worker ./
COPY --from=build --chown=nodeapp:nodejs /app/packages/llm-client/src/assets ./dist/packages/llm-client/src/assets
USER nodeapp
CMD ["node", "dist/main.js"]
