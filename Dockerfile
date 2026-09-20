FROM node:20-alpine AS client-build

WORKDIR /build/client

COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/index.html ./
COPY client/vite.config.js ./
COPY client/src ./src

ARG VITE_APP_BASE=./
ENV VITE_APP_BASE=${VITE_APP_BASE}

RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=client-build /build/client/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:8080/healthz || exit 1
