# Architecture

The manager is built on one principle: **a transport-agnostic core, driven identically by a CLI and a web
server.** Neither front-end contains business logic — they both call the same core services, and both are
described by a single shared **command map**, so a command and its UI button can't drift apart.

```
                    ┌──────────────────────────────────────────────┐
   mm <verb>  ─────▶│                                              │
   (CLI)            │              Command Map                     │◀───── mm web
                    │   one entry per noun; Verbs[] + Transport    │       (web server)
                    └───────────────────┬──────────────────────────┘
                                        │
                    ┌───────────────────▼──────────────────────────┐
                    │                Shared Core                    │
                    │  ManifestLoader · ModuleIntrospector ·        │
                    │  ProcessRunner · DependencyGraph ·            │
                    │  BulkOperation-Engine · PrePublishValidator   │
                    └───────────────────┬──────────────────────────┘
                                        │
                    ┌───────────────────▼──────────────────────────┐
                    │   the monorepo on disk + npm registry + git   │
                    └───────────────────────────────────────────────┘
```

## The command map

`source/cli/MonorepoManager-CommandMap.cjs` is the single description of what the tool can do: one entry
per noun (`status`, `run`, `ripple`, `bulk`, `manifest`, …), each carrying its verbs, options, a
`Transport` marker (`native` | `web-only` | `mode-divergent`), and a handler. `CommandFactory` turns that
map into [pict-service-commandlineutility](https://github.com/fable-retold/pict-service-commandlineutility)
commands for the CLI; the **same map** is what the web UI reads to render its actions. Add a capability
once and both faces get it.

## The core services

Plain, injectable classes under `source/core/` and `source/bulk/` — no framework coupling, so they are
require-and-go and unit-testable:

- **ManifestLoader** — locates the `Modules-Manifest.json` (git-style walk-up), parses it, and builds the
  `moduleByName` / `groupByName` indexes plus the tool's runtime config (with sane defaults). Accepts any
  manifest that has a `Groups[].Modules[]` array.
- **ModuleIntrospector** — origin-only per-module state: branch, ahead/behind, dirty files, next action,
  local vs published version. No fork/upstream drift — there is one remote.
- **ProcessRunner** — runs npm / git in a module and streams output; the same runner feeds the CLI's stdout
  and the web server's WebSocket broadcaster.
- **DependencyGraph** — a pure graph (impact-of / topo-order / cycle detection via Tarjan) built from an
  adapter over the manifest, feeding both `mm ripple` and the bulk planners.
- **BulkOperation-Engine** — a generic runner for *planned* work (see
  [Bulk Operations](bulk-operations.md)): a durable checkpoint manifest, a task registry, confirm-gates,
  retry-from-failed, and bounded parallelism.
- **PrePublishValidator** — the guard in front of every publish.

## The two faces

- **CLI** (`source/cli/`) — `mm` / `monorepo-manager`. Handlers parse their own args and call the core.
  Headless and scriptable; every command has a stable, semantic name.
- **Web server** (`source/web_server/`) — `mm web` composes Fable → Orator → the shared core → REST routes
  + a WebSocket operation stream, and serves the built browser bundle. Long-running commands are kicked as
  *operations* that stream their output to the UI; the generic **ServiceSupervisor** manages any dev
  servers the manifest declares. See [Web Interface](web-interface.md).

## Packaging

The whole thing ships as one package (CLI + web server + built web bundle) and as a **Docker image** that
bind-mounts the target monorepo at `/monorepo` — nothing about a specific repo is baked in. See
[Docker &amp; Deployment](docker.md).
