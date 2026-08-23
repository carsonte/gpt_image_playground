FROM node:22-bookworm-slim AS build

WORKDIR /app

ENV VITE_SERVER_MANAGED_API=true
ENV VITE_DEFAULT_API_URL=https://proxy?model=gpt-image-2&apiMode=images&streamImages=true&streamPartialImages=2
ENV VITE_API_PROXY_AVAILABLE=true
ENV VITE_API_PROXY_LOCKED=true
ENV VITE_SHOW_PRESET_CONFIG_ONLY=true
ENV VITE_LOCK_PRESET_CONFIG_PARAMS=true
ENV VITE_PREVENT_PRESET_CONFIG_DELETION=true

COPY package.json package-lock.json ./
RUN sed -i 's|deb.debian.org|mirrors.cloud.tencent.com|g' /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV DATA_DIR=/app/data
ENV UPSTREAM_API_URL=https://api.blackengine.top/v1
ENV UPSTREAM_MODEL=gpt-image-2
ENV ADMIN_USERNAME=admin
ENV TRUST_PROXY=1
ENV REQUEST_LOG_RETENTION_DAYS=30
ENV AUDIT_LOG_RETENTION_DAYS=180
ENV IP_ACTIVITY_RETENTION_DAYS=90

COPY package.json package-lock.json ./
RUN sed -i 's|deb.debian.org|mirrors.cloud.tencent.com|g' /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && npm ci --omit=dev \
  && apt-get purge -y --auto-remove python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server ./server

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 8080

CMD ["node", "server/index.mjs"]
