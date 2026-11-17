FROM node:22-alpine AS builder
WORKDIR /usr/src/app/server
RUN apk add --no-cache python3 make g++
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-alpine AS dashboard-builder
WORKDIR /usr/src/app/server/dashboard
COPY server/dashboard/package.json server/dashboard/package-lock.json ./
RUN npm ci
COPY server/dashboard/index.html server/dashboard/vite.config.js ./
COPY server/dashboard/src/ ./src/
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /usr/src/app/server
RUN apk add --no-cache tini wget
ENV NODE_ENV=production
ENV PORT=4000
COPY --chown=node:node --from=builder /usr/src/app/server/node_modules ./node_modules
COPY --chown=node:node server/package.json server/package-lock.json ./
COPY --chown=node:node server/src/ ./src/
COPY --chown=node:node --from=dashboard-builder /usr/src/app/server/dashboard/dist/ ./dashboard/dist/
COPY --chown=node:node electron/services/license/licenseFormat.js electron/services/license/licensePublicKey.js /usr/src/app/electron/services/license/
USER node
HEALTHCHECK --interval=15s --timeout=4s --retries=3 CMD wget -qO- http://localhost:4000/api/v1/health || exit 1
EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/app.js"]
