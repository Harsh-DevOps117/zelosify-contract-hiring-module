# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS backend-build
COPY Zelosify-Backend/Server/package*.json ./
COPY Zelosify-Backend/Server/prisma ./prisma
RUN npm ci
COPY Zelosify-Backend/Server/ ./
RUN npm run build

FROM base AS backend
ENV NODE_ENV=production
COPY --from=backend-build --chown=node:node /app/package*.json ./
# Prisma CLI is retained for the one-off migration service.
COPY --from=backend-build --chown=node:node /app/node_modules ./node_modules
COPY --from=backend-build --chown=node:node /app/dist ./dist
COPY --from=backend-build --chown=node:node /app/prisma ./prisma
COPY --from=backend-build --chown=node:node /app/workers ./workers
COPY --chown=node:node docker/backend-entrypoint.mjs ./docker-entrypoint.mjs
USER node
EXPOSE 5000
CMD ["node", "docker-entrypoint.mjs"]

FROM base AS frontend-build
COPY Zelosify-Frontend/package*.json ./
RUN npm ci
COPY Zelosify-Frontend/ ./
ARG NEXT_PUBLIC_BACKEND_URL=http://localhost:5000/api/v1
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS frontend
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=frontend-build --chown=node:node /app/package*.json ./
COPY --from=frontend-build --chown=node:node /app/node_modules ./node_modules
COPY --from=frontend-build --chown=node:node /app/.next ./.next
COPY --from=frontend-build --chown=node:node /app/public ./public
COPY --from=frontend-build --chown=node:node /app/next.config.mjs ./
USER node
EXPOSE 5173
CMD ["npm", "start", "--", "--hostname", "0.0.0.0"]
