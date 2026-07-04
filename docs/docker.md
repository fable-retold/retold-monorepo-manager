# Docker &amp; Deployment

The manager ships as a container image bundling the CLI + web server + built UI. Nothing about a specific
repo is baked in — you **bind-mount the monorepo you want to manage** at `/monorepo`, and the server walks
up from there to find its `Modules-Manifest.json`.

## Run it

```bash
# with docker compose (reads MONOREPO from the environment)
MONOREPO=/abs/path/to/your/monorepo docker compose up --build      # http://localhost:44444

# …or without compose
bin/run-local.sh /abs/path/to/your/monorepo                        # builds if needed, then runs
```

The mounted monorepo needs a `Modules-Manifest.json` at (or above) its root — generate one with
`mm manifest migrate` or `mm manifest backfill --write` (see [The Manifest](manifest-schema.md)).

## Git operations inside the container

Read-only inspection needs nothing extra. For `commit` / `push`, mount your git identity read-only:

```bash
bin/run-local.sh /abs/path/to/monorepo   # then set MOUNT_GIT=1 to add ~/.gitconfig + ~/.ssh (ro)
```

Mutating operations write **back into the bind mount**, and durable bulk runs persist to
`<monorepo>/.monorepo-manager-runs/`, so state survives container restarts.

> **macOS note.** Docker Desktop's virtiofs can't do nested/overlay bind mounts — the manifest must be a
> real file inside the mounted tree, not overlaid on top of it.

## Build + publish the image

```bash
npm run docker:build              # → monorepo-manager:local
npm run publish:docker            # build + push to GHCR (ghcr.io/fable-retold/…)
npm run publish:docker:local      # local buildx → GHCR (honours DRY_RUN)
```

A GitHub Actions workflow (`.github/workflows/publish-image.yml`) builds a multi-arch (amd64 + arm64) image
and pushes it to GHCR on a `v*.*.*` tag. The `release:{patch,minor,major}:image` npm scripts bump the
version and cut the image in one step.

Full details — the two-stage Dockerfile, the `.dockerignore` gotcha for the web build, and the release flow
— are in **`BUILDING-AND-PUBLISHING.md`** in the repository.
