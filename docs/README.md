# Monorepo Manager

**`retold-monorepo-manager`** manages any monorepo from a single `Modules-Manifest.json`. Point it at a
tree of modules — subfolders full of packages, a docs folder, scattered `package.json`s, services in odd
places — and it gives you status, dependency-graph **ripple** publishing, dependency audits, service
supervision, and manifest hygiene, from both a **command line** (`mm`) and a **web UI** (`mm web`).

It is the generic successor to the retold-specific `retold-manager` tool: all fork / pull-request /
multi-state machinery is gone, and the dependency-graph ripple engine is kept and expanded. Nothing about
your ecosystem is hardcoded — everything comes from the manifest or a small runtime config, so the same
tool drives retold and any other monorepo.

## What it does

- **Status** — per-module git status (origin-only: branch, ahead/behind, dirty, next action) and
  local-vs-published npm version, across every module in the manifest.
- **Ripple** — build the inter-module dependency graph, compute blast-radius / impact, and run a
  topologically-ordered version-bump + publish cascade — no fork/PR steps.
- **Lifecycle** — per-module `install` / `test` / `build`, version bump, commit, publish (behind a
  pre-publish validator), and dependency-update checks.
- **Bulk operations** — a generic engine that runs *planned* work across many modules: flat sweeps
  (update / test / build) and the topological ripple, each **gated, resumable, and logged**.
- **Services** — supervise long-running dev servers / services declared per-module.
- **Manifest hygiene** — audit the manifest against what is actually on disk, backfill missing entries
  by discovery, and migrate a legacy manifest into the v2 schema.

## Design principles

- **Config-driven, not repo-specific.** No ecosystem names are hardcoded; everything comes from the
  manifest or a small runtime config block.
- **One core, two faces.** A transport-agnostic core drives both the CLI and the web UI. Every UI action
  has a clean semantic CLI equivalent, declared once in a shared command map — the two can't drift.
- **Declare-authoritative.** The manifest is the source of truth; discovery only runs on explicit
  `audit` / `backfill` commands.

## A quick taste

```bash
npm install -g retold-monorepo-manager      # installs `monorepo-manager` + the `mm` alias

cd ~/code/your-monorepo
mm health                                    # tool version + a summary of the discovered manifest
mm status --dirty-only                       # what needs attention right now
mm ripple impact --root fable                # what a change to `fable` would cascade to
mm web                                        # open the web UI on http://127.0.0.1:44444
```

`mm` finds the manifest git-style, by walking up from the current directory (override with
`--manifest <path>`).

## Where to next

- **[Quick Start](quickstart.md)** — install, first commands, and the web UI in five minutes.
- **[Configuration](configuration.md)** — the runtime config block (web server, auth, logging, ripple).
- **[The Manifest](manifest-schema.md)** — the `Modules-Manifest.json` schema, group by group.
- **[Bulk Operations &amp; Ripple](bulk-operations.md)** — the engine, the catalog, and the wizard.
- **[Web Interface](web-interface.md)** — the module list, per-module workspace, and live output.
- **[Docker &amp; Deployment](docker.md)** — run it as a container with your monorepo bind-mounted.
- **[Architecture](architecture.md)** — how the core, CLI, web server, and bulk engine fit together.
- **[CLI Reference](cli-reference.md)** — every command and flag.
