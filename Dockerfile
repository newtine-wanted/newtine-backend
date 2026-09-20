FROM node:24-bookworm-slim AS runtime-deps

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

FROM runtime-deps AS api

COPY --chown=node:node dist ./dist
COPY --chown=node:node config ./config
COPY --chown=node:node scripts/migrate.mjs ./scripts/migrate.mjs

USER node

EXPOSE 3000

CMD ["node", "dist/apps/api/src/main.js"]

FROM runtime-deps AS batch

COPY --chown=node:node dist ./dist
COPY --chown=node:node config ./config
COPY --chown=node:node scripts/news-*.mjs ./scripts/
COPY --chown=node:node prompts/news-pipeline ./prompts/news-pipeline
COPY --chown=node:node docs/news-pipeline/direction ./docs/news-pipeline/direction

RUN mkdir -p /app/.local && chown node:node /app/.local

USER node

CMD ["node", "dist/apps/batch/src/main.js"]

# Keep an explicit default target so existing docker builds and the local
# migrate service continue to build the API image.
FROM api AS runtime
