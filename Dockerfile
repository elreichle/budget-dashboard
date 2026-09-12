# budget-dashboard container: one Node process serving the API and the built dashboard.
# Personal data never enters the image; mount your data directory at /data (see README).

# Build stage: dev dependencies for vite and tsc, then prune to production dependencies.
# better-sqlite3 normally downloads a prebuilt binary; the compilers cover platforms without one.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# Runtime stage: same Debian base so the native module built above loads; no compilers.
FROM node:22-bookworm-slim
WORKDIR /app
# HOST=0.0.0.0 so the published port reaches Node; publish it on 127.0.0.1 (see the compose example).
ENV NODE_ENV=production DATA_DIR=/data PORT=8420 HOST=0.0.0.0
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8420
CMD ["node", "dist/server/index.js"]
