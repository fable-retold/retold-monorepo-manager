# Monorepo Manager — two-stage image.
#
# The app operates on a FOREIGN monorepo mounted at runtime (bind-mount it at /monorepo). The image
# ships the CLI + web server + the built browser UI; git + npm are present so per-module operations
# (status, install, test, version, ripple-publish, …) run inside the container against the mount.
#
#   docker build -t monorepo-manager:local .
#   docker run --rm -p 44444:44444 -v /path/to/your/monorepo:/monorepo monorepo-manager:local
#
# The mounted monorepo must have a Modules-Manifest.json at (or above) its root; the server finds it
# git-style by walking up from /monorepo.

# ─────────────────────────────────────── Builder ───────────────────────────────────────
FROM node:22-bookworm AS builder
WORKDIR /app

# Build toolchain for any native modules.
RUN apt-get update && apt-get install -y --no-install-recommends build-essential python3 && rm -rf /var/lib/apt/lists/*

# Root deps (CLI + web server stack). Lockfiles are intentionally absent (.npmrc package-lock=false),
# so this is `npm install`, never `npm ci`.
COPY package.json .npmrc ./
RUN npm install

# Webinterface deps (pict + quackage) — cached until webinterface/package.json changes.
COPY webinterface/package.json ./webinterface/package.json
RUN cd webinterface && npm install

# Bring in the source and build the browser bundle. The machine-specific quackage config is excluded
# via .dockerignore and regenerated here with in-container (/app) paths.
COPY . .
RUN cd webinterface && npm run build

# Prune the root install to production deps for the runtime copy.
RUN npm prune --omit=dev

# ─────────────────────────────────────── Runtime ───────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production

WORKDIR /app
COPY --from=builder /app/package.json /app/.npmrc /app/Modules-Manifest.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/source ./source
COPY --from=builder /app/webinterface/dist ./webinterface/dist
COPY --from=builder /app/docs ./docs
RUN date -u +%Y-%m-%dT%H:%M:%SZ > /app/build.date

EXPOSE 44444

# The target monorepo is bind-mounted here; the server walks up from the working directory to find
# its Modules-Manifest.json.
WORKDIR /monorepo

HEALTHCHECK --interval=30s --timeout=4s --start-period=8s --retries=3 \
	CMD node -e "require('http').get('http://127.0.0.1:44444/api/manager/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "/app/source/cli/MonorepoManager-Run.cjs", "web", "--host", "0.0.0.0", "--port", "44444"]
