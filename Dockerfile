FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

COPY --chown=node:node dist ./dist
COPY --chown=node:node config ./config
COPY --chown=node:node scripts/migrate.mjs ./scripts/migrate.mjs

USER node

EXPOSE 3000

CMD ["node", "dist/apps/api/src/main.js"]
