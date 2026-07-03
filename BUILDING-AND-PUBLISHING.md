# Building and Publishing

How to build, run, and ship `retold-monorepo-manager` as a container image, plus the npm + GitHub
Container Registry (GHCR) release flow. The structure matches the shared template across the
dockerized retold tools (ultravisor, data-mapper).

Unlike a typical service, this tool **operates on a *foreign* monorepo mounted at runtime**. The
image ships the CLI + web server + built browser UI (and `git` + `npm`); you bind-mount the monorepo
you want to manage at `/monorepo`. Nothing about a specific monorepo is baked into the image.

---

## TL;DR — run it locally

```bash
# build the image once
npm run docker:build            # → monorepo-manager:local

# run it against a monorepo on your machine (opens http://localhost:44444)
MONOREPO=/absolute/path/to/your/monorepo docker compose up --build
#   …or, without compose:
bin/run-local.sh /absolute/path/to/your/monorepo
```

The mounted monorepo must have a `Modules-Manifest.json` at (or above) its root — the server finds
it git-style by walking up from `/monorepo`. If yours doesn't have one yet, generate it first with
`mm manifest migrate` (from a retold-style manifest) or `mm manifest backfill --write` (synthesize
by scanning folders).

---

## Running the image

```bash
docker run --rm -p 44444:44444 \
	-v /absolute/path/to/your/monorepo:/monorepo \
	ghcr.io/fable-retold/retold-monorepo-manager:latest
```

- **`-p 44444:44444`** — the web UI + REST + WebSocket stream. Change the host side (`-p 8080:44444`)
  to serve elsewhere.
- **`-v <monorepo>:/monorepo`** — the monorepo to manage. Read-heavy operations (status, graph,
  dep audit) need only this. Mutating operations (version bumps, `deps-align`) write back into the
  mount.
- **git identity / push** — `commit` and `push` run `git` inside the container, so mount your
  identity + credentials read-only when you need them:
  ```bash
  -v "$HOME/.gitconfig:/root/.gitconfig:ro" -v "$HOME/.ssh:/root/.ssh:ro"
  ```
  (`bin/run-local.sh` adds both when you pass `MOUNT_GIT=1`; `docker-compose.yml` has them as
  commented-out volumes.)

Durable run manifests land in `<monorepo>/.monorepo-manager-runs/` — history survives container
restarts because it lives on the mount, not in the image.

> **Ripple-publish note:** running a ripple-publish against real modules will `npm publish` to the
> registry. Do that deliberately (behind the confirm-gate), not as a smoke test.

---

## Prerequisites (one-time setup, for publishing)

- **npm login** — `npm whoami` should print your username.
- **Git remote configured** — `git remote get-url origin` should print
  `git@github.com:fable-retold/retold-monorepo-manager.git` (or the HTTPS equivalent).
- **Push access to the repo** — so the `postversion` / `postpublish` hooks can push commits and tags.
- **Docker** — only if you want to build/test the image locally before tagging.

---

## Ecosystem convention: lockfiles are gitignored

`package-lock.json` is gitignored (Quackage convention across the retold ecosystem). The Dockerfile
uses `npm install`, never `npm ci` — `npm ci` requires the lockfile in the build context, and CI
runners only check out what's in git. If you see `EUSAGE` errors in GHCR build logs, that's the
cause.

The webinterface's `.gulpfile-quackage-config.json` carries absolute host paths, so it's excluded
via `.dockerignore` and **regenerated inside the build** (`quack build` derives `/app` paths from
the container's working directory).

---

## Releasing

| Command                          | npm registry | GHCR image rebuild |
|----------------------------------|--------------|--------------------|
| `npm run release:patch`          | yes          | no                 |
| `npm run release:patch:image`    | yes          | yes                |
| `npm run release:minor[:image]`  | yes          | no / yes           |
| `npm run release:major[:image]`  | yes          | no / yes           |

The non-`:image` variants are the default — most releases don't change runtime behavior, and each
multi-arch image build burns several minutes of CI. Use `:image` (or `npm run publish:docker`) when
runtime code, dependencies, or the Dockerfile changed.

### GHCR image tags

Pushing a `v*.*.*` tag fires `.github/workflows/publish-image.yml`, which builds `linux/amd64` +
`linux/arm64` and pushes:

```
ghcr.io/fable-retold/retold-monorepo-manager:<version>
ghcr.io/fable-retold/retold-monorepo-manager:<major>.<minor>
ghcr.io/fable-retold/retold-monorepo-manager:<major>
ghcr.io/fable-retold/retold-monorepo-manager:latest   (stable tags only)
```

Promoting a previous npm-only release to docker later: `git push origin v<x>` re-fires the workflow
without touching npm.

### Local image publish (skip CI)

For a fast single-arch push from your machine (CI multi-arch is ~25 min):

```bash
npm run publish:docker:local            # ghcr.io/fable-retold/…:dev-<sha>
DRY_RUN=1 npm run publish:docker:local  # print what it would do, push nothing
PUBLISH_PLATFORMS=linux/amd64,linux/arm64 PUBLISH_TAG=1.0.0 npm run publish:docker:local
```

Requires `docker login ghcr.io` with a token that has `write:packages`.

---

## Verifying a release

1. **npm**: `npm view retold-monorepo-manager version`
2. **Workflow**: `https://github.com/fable-retold/retold-monorepo-manager/actions`
3. **Image**: `docker pull ghcr.io/fable-retold/retold-monorepo-manager:latest`

If the first `docker pull` returns `denied`, the package is private by default — flip visibility to
public via the package page's Settings → Danger Zone.

---

## Quackage-managed files

`.babelrc`, `.browserslistrc*`, `.gulpfile-quackage*` are generated by Quackage (they contain
absolute machine paths) and are gitignored. Regenerate them with `quack init` / `quack docker-init`;
never hand-edit or copy them between machines.
