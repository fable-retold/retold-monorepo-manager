# Quick Start

## Install

```bash
npm install -g retold-monorepo-manager
```

This installs two bin names — `monorepo-manager` and the short alias **`mm`** used throughout these docs.
You can also run it without installing, via `npx retold-monorepo-manager <command>`.

## Point it at a monorepo

The manager is driven entirely by a **`Modules-Manifest.json`** at (or above) your monorepo root. From
anywhere inside the tree, `mm` walks up to find it — override with `--manifest <path>`.

If your monorepo doesn't have one yet, generate it:

```bash
# convert a legacy/v1 manifest into the v2 schema…
mm manifest migrate --input Old-Manifest.json --output Modules-Manifest.json

# …or discover modules on disk and backfill entries
mm manifest backfill --write
```

See **[The Manifest](manifest-schema.md)** for the full schema.

## First commands

```bash
mm health                 # tool version + a summary of the discovered manifest
mm status                 # origin-only git status + version state for every module
mm status published       # …also query npm for each module's published version
mm status --dirty-only    # only modules that are dirty or need an action
mm show fable             # deep view of one module: manifest, package.json, git, deps
```

Everything reads the manifest and the working tree — nothing mutates until you ask.

## Do something to a module

```bash
mm run pict test                  # run an npm script in a module
mm git pict diff                  # origin-only git ops (pull/push/fetch/diff/log/add/commit)
mm version pict patch             # bump a version (no git tag)
mm deps pict ncu                  # check for outdated dependencies
mm publish check pict             # pre-publish validation (no publish)
```

## See the whole graph

```bash
mm ripple graph                   # the inter-module dependency graph
mm ripple impact --root fable     # everything a change to `fable` would cascade to
mm ripple plan                    # a topologically-ordered version-bump + publish plan
```

See **[Bulk Operations &amp; Ripple](bulk-operations.md)** to actually run planned work.

## Launch the web UI

```bash
mm web                            # http://127.0.0.1:44444, add --open to launch a browser
mm web --port 8080 --host 0.0.0.0
```

The web UI is the same core with a browser front-end: a movable module list, a per-module workspace with
grouped actions, a bulk-operation wizard, and a live output panel that streams every running command over
a WebSocket. See **[Web Interface](web-interface.md)**.

## Run it in a container

```bash
MONOREPO=/abs/path/to/your/monorepo docker compose up --build   # http://localhost:44444
```

The image bundles the CLI + web server + UI; you bind-mount the monorepo you want to manage at
`/monorepo`. See **[Docker &amp; Deployment](docker.md)**.
