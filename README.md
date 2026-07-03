# retold-monorepo-manager

A generic, config-driven monorepo manager. Point it at any monorepo — subfolders full of
modules, a docs folder, spread-out `package.json`s, services in odd folders — via a plain
`Modules-Manifest.json`, and get status, dependency-graph **ripple** publishing, dep audits,
service supervision, and manifest hygiene from both a **command line** and (from Phase 3) a
**web UI**. One shared core drives both; every UI action has a clean semantic CLI equivalent.

It is the generic successor to the retold-specific `retold-manager` tool, with all fork /
pull-request / multi-state machinery removed and the dependency-graph ripple engine kept and
expanded.

> **Status: complete (Phases 0–6) — CLI + web server + web UI + bulk operations + Docker.** The
> scaffold, generic manifest core, the full headless CLI, the **web server** (`mm web`), the **web
> UI** (the movable module list + per-module workspace + live output), the **bulk-operation
> subsystem** (a generic engine running *planned* work across modules — flat sweeps like
> update/test/build, and the topological **ripple publish** — with a Choose→Preview→Run wizard and a
> `mm ripple`/`mm bulk` CLI), and the **container image** (mount any monorepo at `/monorepo`) are all
> done and verified. See [REFACTOR-PLAN.md](./REFACTOR-PLAN.md), [PHASE5-DESIGN.md](./PHASE5-DESIGN.md),
> and [BUILDING-AND-PUBLISHING.md](./BUILDING-AND-PUBLISHING.md).

## Run it in Docker

The image ships the CLI + web server + UI; you bind-mount the monorepo you want to manage.

```bash
npm run docker:build                                              # → monorepo-manager:local
MONOREPO=/absolute/path/to/your/monorepo docker compose up --build   # http://localhost:44444
# …or without compose:  bin/run-local.sh /absolute/path/to/your/monorepo
```

The mounted monorepo needs a `Modules-Manifest.json` at (or above) its root (generate one with
`mm manifest migrate` / `mm manifest backfill --write`). Mutating ops write back into the mount;
mount `~/.gitconfig` + `~/.ssh` read-only for `commit`/`push`. Full details, GHCR publishing, and
the release flow are in [BUILDING-AND-PUBLISHING.md](./BUILDING-AND-PUBLISHING.md).

## Install

```bash
npm install
```

The tool installs two bin names: `monorepo-manager` and the short alias `mm`.

## Quick start

From anywhere inside a monorepo that has a `Modules-Manifest.json` at (or above) the current
directory:

```bash
mm health          # tool version + a summary of the discovered manifest
```

`mm` finds the manifest git-style, by walking up from the current directory. Override with
`--manifest <path>`.

## Configuration — `Modules-Manifest.json`

The manifest is the single source of truth: groups (folders of modules), per-module metadata,
git/docs URL templates, ripple action templates, ecosystem membership, and optional service
descriptors. It is **declare-authoritative** — nothing is scanned at read time; discovery runs
only on the explicit `mm manifest audit` / `mm manifest backfill` commands. See
[docs/manifest-schema.md](./docs/manifest-schema.md) for the full schema, and the sample
`Modules-Manifest.json` in this repo for a working example.

## Command grammar

```
mm <noun> <verb> [target] [--options]
```

Every command is declared in one place — `source/cli/MonorepoManager-CommandMap.cjs` — which
the CLI and the web client both read, so the two can never drift. See
[docs/cli-reference.md](./docs/cli-reference.md).

## Development

```bash
npm test           # Mocha TDD
```

Code style: tabs, plain JavaScript, Allman braces, `pVariable` / `tmpVariable` / `VARIABLE` /
`libSomething` naming. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT © Steven Velozo
