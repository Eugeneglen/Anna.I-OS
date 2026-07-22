# ============================================================
# Anna.I — Production Dockerfile for Railway
#
# CRITICAL: schema.prisma in the repo uses provider = "sqlite"
# for local dev. This Dockerfile auto-converts it to
# "postgresql" at build time — NEVER hardcode postgresql
# into schema.prisma in the repo.
#
# Rule: node_modules is copied in full — Prisma CLI needs
# the complete dependency tree at runtime.
#
# Railway: This service MUST use the "Dockerfile" builder,
# NOT Railpack/Nixpacks. Click "Force Dockerfile builder"
# in Railway Settings if it defaults to Railpack.
# ============================================================

FROM node:20-slim AS base
RUN npm install -g bun
WORKDIR /app

# ── Stage 1: Install dependencies ────────────────────────────
FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# ── Stage 2: Build Next.js ───────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Auto-convert provider from sqlite → postgresql for production
RUN sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma

# Generate Prisma client for PostgreSQL, then build
RUN npx prisma generate
RUN NEXT_TELEMETRY_DISABLED=1 npx next build

# Copy static assets and public into standalone
RUN cp -r .next/static .next/standalone/.next/ && \
    cp -r public .next/standalone/

# ── Stage 3: Production runtime ──────────────────────────────
FROM node:20-slim AS runner
RUN npm install -g bun
WORKDIR /app
ENV NODE_ENV=production

# Full node_modules copy — Prisma CLI needs the complete tree
# at runtime (pre-deploy prisma db push, prisma db seed)
COPY --from=builder /app/node_modules ./node_modules

# Prisma schema (already converted to postgresql in builder stage)
COPY --from=builder /app/prisma ./prisma

# Seed scripts
COPY --from=builder /app/scripts ./scripts

# Entrypoint (runs prisma db push + seed before server start)
COPY --from=builder /app/entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh

# Next.js standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/package.json ./

EXPOSE 8080
ENV PORT=8080
ENV HOSTNAME="0.0.0.0"

CMD ["./entrypoint.sh"]