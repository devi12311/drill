# syntax=docker/dockerfile:1

# ── deps ─────────────────────────────────────────────────────────────────────
# Install the full dependency tree once; reused by build and copied (in part)
# into the runner for the standalone migration script.
FROM node:22.21.1-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── builder ──────────────────────────────────────────────────────────────────
FROM node:22.21.1-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `output: "standalone"` in next.config.ts → .next/standalone (server + pruned
# node_modules). Telemetry off so builds are hermetic.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── runner ───────────────────────────────────────────────────────────────────
FROM node:22.21.1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run as an unprivileged user.
RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs nextjs

# Standalone server + its assets.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Migration assets. The standalone bundle prunes untraced files, so explicitly
# ship the migrator's deps (drizzle-orm/postgres are used at runtime anyway, but
# the /migrator submodule is not traced) alongside the generated SQL + script.
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts ./scripts
COPY --from=deps    /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=deps    /app/node_modules/postgres    ./node_modules/postgres

USER nextjs
EXPOSE 3000

# server.js is emitted at the standalone root by Next.
CMD ["node", "server.js"]
