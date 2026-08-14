# syntax=docker/dockerfile:1

FROM node:22-alpine AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
	npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci
COPY . .
RUN npm test && npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
	HOMESTEAD_HOST=0.0.0.0 \
	HOMESTEAD_DATA_DIR=/data \
	PORT=4174

WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json attachment-service.mjs codex-bridge.mjs homestead-store.mjs server.mjs ./
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 4174
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:4174/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "server.mjs"]
