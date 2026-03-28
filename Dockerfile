# ── Stage 1: install ALL deps (build + runtime) ──────────────────────────
FROM oven/bun:1-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json
COPY packages/cli/package.json packages/cli/package.json
RUN bun install --frozen-lockfile

# ── Stage 2: build server + client ───────────────────────────────────────
FROM oven/bun:1-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=deps /app/packages/client/node_modules ./packages/client/node_modules
COPY --from=deps /app/packages/cli/node_modules ./packages/cli/node_modules
COPY . .
RUN bun run build

# ── Stage 3: production-only node_modules ────────────────────────────────
FROM oven/bun:1-slim AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json
COPY packages/cli/package.json packages/cli/package.json
RUN bun install --frozen-lockfile --production \
 && find node_modules -type d \( \
      -name "docs" -o -name "test" -o -name "tests" -o -name "__tests__" \
      -o -name "example" -o -name "examples" -o -name ".github" \
      -o -name "coverage" -o -name ".nyc_output" -o -name "benchmark" \
    \) -prune -exec rm -rf {} + 2>/dev/null; \
    find node_modules -type f \( \
      -name "*.md" -o -name "*.map" -o -name "CHANGELOG*" \
      -o -name "*.d.ts" -o -name "*.d.mts" -o -name "*.ts.map" \
      -o -name "LICENSE*" -o -name "LICENCE*" -o -name "README*" \
      -o -name ".editorconfig" -o -name ".eslintrc*" -o -name ".prettierrc*" \
    \) -delete 2>/dev/null; true

# ── Stage 4: grab static Docker CLI + Compose (no apt bloat) ────────────
FROM oven/bun:1-slim AS docker-cli

ARG DOCKER_VERSION=28.1.1
ARG COMPOSE_VERSION=2.35.1
ARG TARGETARCH

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && ARCH=$(case "${TARGETARCH}" in arm64) echo "aarch64";; *) echo "x86_64";; esac) \
 && curl -fsSL "https://download.docker.com/linux/static/stable/${ARCH}/docker-${DOCKER_VERSION}.tgz" \
    | tar xz --strip-components=1 -C /usr/local/bin docker/docker \
 && COMPOSE_ARCH=$(case "${TARGETARCH}" in arm64) echo "aarch64";; *) echo "x86_64";; esac) \
 && curl -fsSL -o /usr/local/bin/docker-compose \
    "https://github.com/docker/compose/releases/download/v${COMPOSE_VERSION}/docker-compose-linux-${COMPOSE_ARCH}" \
 && chmod +x /usr/local/bin/docker-compose \
 && mkdir -p /usr/local/lib/docker/cli-plugins \
 && ln -s /usr/local/bin/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose \
 && rm -rf /var/lib/apt/lists/*

# ── Stage 5: runtime ────────────────────────────────────────────────────
FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Install only the lightweight runtime deps (git, ssh, rclone, 7z)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git openssh-client p7zip-full rclone \
 && rm -rf /var/lib/apt/lists/*

# Static Docker CLI + Compose from builder (no apt repo overhead)
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/bin/docker-compose /usr/local/bin/docker-compose
COPY --from=docker-cli /usr/local/lib/docker/cli-plugins /usr/local/lib/docker/cli-plugins

# Create staging directory for git clones and build contexts
RUN mkdir -p /app/staging

# App artifacts — prod node_modules + built code
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=prod-deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/client/dist ./packages/client/dist
COPY --from=build /app/packages/shared ./packages/shared
COPY drizzle ./drizzle
COPY package.json ./
COPY packages/server/package.json ./packages/server/package.json
COPY packages/client/package.json ./packages/client/package.json
COPY packages/shared/package.json ./packages/shared/package.json

EXPOSE 3000
CMD ["bun", "packages/server/dist/index.js"]
