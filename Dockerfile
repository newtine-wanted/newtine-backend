# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build

WORKDIR /app

# ttsc compiles a native TypeScript-Go plugin; keep that build within a small
# Docker Desktop memory allocation.
ENV GOMAXPROCS=1 GOGC=50

RUN apt-get update \
    && apt-get install --no-install-recommends --yes ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN --mount=type=cache,id=newtine-backend-ttsc,target=/app/node_modules/.cache/ttsc,sharing=locked \
    npm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/config ./config
COPY --from=build --chown=node:node /app/scripts/migrate.mjs ./scripts/migrate.mjs

USER node

EXPOSE 3000

CMD ["node", "dist/apps/api/src/main.js"]
