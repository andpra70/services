FROM node:20-alpine AS client-build

WORKDIR /build/client

COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/index.html ./
COPY client/vite.config.js ./
COPY client/src ./src

ARG VITE_API_BASE=/api
ARG VITE_APP_BASE=./
ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_APP_BASE=${VITE_APP_BASE}

RUN npm run build

FROM node:20-alpine AS server-deps

WORKDIR /build/server

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine

WORKDIR /app

COPY server/package.json ./server/package.json
COPY server/src ./server/src
COPY --from=server-deps /build/server/node_modules ./server/node_modules
COPY --from=client-build /build/client/dist ./client-dist

RUN addgroup -S appgroup && adduser -S appuser -G appgroup && \
    mkdir -p /data && \
    chown -R appuser:appgroup /app /data

ENV NODE_ENV=production
ENV PORT=8080
ENV VOLUME_ROOT=/data
ENV CLIENT_DIST=/app/client-dist
ENV APP_BASE=/
ENV CORS_ORIGIN=http://localhost:8080
ENV MAX_EDITABLE_BYTES=1048576

EXPOSE 8080

USER appuser

CMD ["node", "server/src/index.js"]
