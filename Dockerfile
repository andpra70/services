FROM node:20-alpine AS client-build

WORKDIR /build/client

COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/index.html ./
COPY client/example.html ./
COPY client/public ./public
COPY client/vite.config.js ./
COPY client/src ./src

ARG VITE_API_BASE=/api
ARG VITE_APP_BASE=./
ARG VITE_OAUTH_ISSUER=http://localhost:9000
ARG VITE_OAUTH_STORAGE_KEY=fileserver-oauth-widget
ARG VITE_OAUTH_COMPONENT_URL=
ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_APP_BASE=${VITE_APP_BASE}
ENV VITE_OAUTH_ISSUER=${VITE_OAUTH_ISSUER}
ENV VITE_OAUTH_STORAGE_KEY=${VITE_OAUTH_STORAGE_KEY}
ENV VITE_OAUTH_COMPONENT_URL=${VITE_OAUTH_COMPONENT_URL}

RUN npm run build

FROM node:20-alpine AS server-deps

WORKDIR /build/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine

WORKDIR /app

ARG APP_UID=1000
ARG APP_GID=1000

RUN apk add --no-cache weasyprint font-noto ttf-freefont

COPY server/package.json ./server/package.json
COPY server/src ./server/src
COPY --from=server-deps /build/server/node_modules ./server/node_modules
COPY --from=client-build /build/client/dist ./client-dist

RUN mkdir -p /data && \
    chown -R "${APP_UID}:${APP_GID}" /app /data

ENV NODE_ENV=production
ENV PORT=8080
ENV VOLUME_ROOT=/data
ENV CLIENT_DIST=/app/client-dist
ENV APP_BASE=/
ENV CORS_ORIGIN=http://localhost:8080
ENV MAX_EDITABLE_BYTES=1048576
ENV MAX_BINARY_FILE_BYTES=52428800
ENV OAUTH_ISSUER=http://localhost:9000
ENV TOKEN_VALIDATION_CACHE_TTL_MS=15000
ENV WEASYPRINT_BIN=/usr/bin/weasyprint

EXPOSE 8080

USER ${APP_UID}:${APP_GID}

CMD ["node", "server/src/index.js"]
