# syntax=docker/dockerfile:1
# Scheduler. Build no contexto da RAIZ: docker build -f apps/scheduler/Dockerfile -t medcheckin-scheduler .
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/scheduler/package.json apps/scheduler/
COPY packages/core/package.json packages/core/
RUN npm ci --ignore-scripts --omit=dev -w @medcheckin/scheduler -w @medcheckin/core

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app && apk add --no-cache curl
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=app:app package.json ./
COPY --chown=app:app packages/core ./packages/core
COPY --chown=app:app apps/scheduler ./apps/scheduler
USER app
EXPOSE 3001
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 CMD curl -fsS http://127.0.0.1:3001/health || exit 1
CMD ["node", "apps/scheduler/src/index.js"]
