FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY client/package.json client/package-lock.json ./client/
RUN npm --prefix client ci
COPY client ./client
COPY public ./public

ARG VITE_APP_BASE=./
ENV VITE_APP_BASE=${VITE_APP_BASE}
RUN npm run build:client

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
COPY --from=build --chown=node:node /app/public/vfs-widget.js ./public/vfs-widget.js
COPY --from=build --chown=node:node /app/client/dist ./client-dist

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "Promise.all([fetch('http://127.0.0.1:8080/healthz'),fetch('http://127.0.0.1:8080/widget.js')]).then(r=>process.exit(r.every(x=>x.ok)?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/server.js"]
