FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile --filter @proofhound/web...

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/web apps/web
RUN pnpm --filter @proofhound/web build

FROM node:24-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
RUN addgroup -g 1001 -S nodejs && adduser -S nodeapp -u 1001 -G nodejs
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=nodeapp:nodejs /app/apps/web/.next ./.next
COPY --from=build --chown=nodeapp:nodejs /app/apps/web/public ./public
COPY --from=build --chown=nodeapp:nodejs /app/apps/web/package.json ./package.json
COPY --from=build --chown=nodeapp:nodejs /app/node_modules ./node_modules
EXPOSE 3000
USER nodeapp
CMD ["pnpm", "start"]
