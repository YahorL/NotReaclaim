# syntax=docker/dockerfile:1

###############################################################################
# Stage 1: build — install workspace deps, generate the Prisma client, compile
# every package in dependency order, and build the web SPA.
# glibc (Debian bookworm) base: Prisma query/migration engines and the
# @node-rs/argon2 *-linux-x64-gnu prebuilt binary both load without a toolchain.
###############################################################################
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Copy manifests first so `npm ci` is cached until a package.json changes.
COPY package.json package-lock.json ./
COPY packages/core/package.json       packages/core/package.json
COPY packages/scheduler/package.json  packages/scheduler/package.json
COPY packages/google/package.json     packages/google/package.json
COPY packages/db/package.json         packages/db/package.json
COPY packages/server/package.json     packages/server/package.json
COPY packages/web/package.json        packages/web/package.json
RUN npm ci

# Copy the rest of the source.
COPY . .

# Generate the Prisma client (both the db tsc build and runtime migrate need it).
RUN npm run prisma:generate -w @notreclaim/db

# Compile in dependency order, then build the SPA (outputs packages/web/dist).
RUN npm run build -w @notreclaim/core \
 && npm run build -w @notreclaim/scheduler \
 && npm run build -w @notreclaim/google \
 && npm run build -w @notreclaim/db \
 && npm run build -w @notreclaim/server \
 && npm run build -w @notreclaim/web

###############################################################################
# Stage 2: server — Node runtime for the Fastify API. Retains node_modules
# (incl. the Prisma CLI) so the entrypoint can run `prisma migrate deploy`.
###############################################################################
FROM node:20-bookworm-slim AS server
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages
COPY docker/server-entrypoint.sh /usr/local/bin/server-entrypoint.sh
RUN chmod +x /usr/local/bin/server-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/server-entrypoint.sh"]

###############################################################################
# Stage 3: web — Caddy serving the built SPA + reverse-proxying the API.
###############################################################################
FROM caddy:2.8-alpine AS web
COPY --from=build /app/packages/web/dist /srv
COPY docker/Caddyfile /etc/caddy/Caddyfile
EXPOSE 8080
