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
RUN npm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/config ./config

USER node

EXPOSE 3000

CMD ["node", "dist/apps/api/src/main.js"]
