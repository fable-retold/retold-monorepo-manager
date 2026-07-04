# Web Interface

`mm web` starts an [Orator](https://github.com/fable-retold/orator) server that hosts a
[Pict](https://github.com/fable-retold/pict) single-page app over the same core the CLI uses. It serves on
`http://127.0.0.1:44444` by default (`--port` / `--host` / `--open` to change).

```bash
mm web --open
```

Everything the UI does maps to a CLI verb — the two share one command map, so the web UI is a *view* of the
tool, never a fork of it.

## The layout

- **Module list** (left / bottom dock) — every module in the manifest, filterable and sortable, with a
  status dot per module (needs-commit / -pull / -push / in-sync). It's *movable*: toggle it between a
  compact left rail and a wide bottom table, and the choice persists.
- **Module workspace** (center) — the per-module detail view. A header with the module's type, branch,
  next-action chip, and GitHub / npm / Docs links; a collapsible floating **info box** (package + git
  status); the changed-files list with per-file staging; and dependency sections (ecosystem deps linked to
  their own module view, external deps listed). Actions are grouped into labelled clusters —
  **npm** (install / test / build / ncu), **version** (patch / minor / major), **git**
  (add / diff / commit / push / pull), and **publish** (publish check → guarded publish) — with overflow
  menus for the less-common ones.
- **Modules / scan table** — a repo-wide table joining manifest metadata with a live scan: branch,
  ahead/behind, next action, local + published version, and changed-file rollups, with filters for
  needs-action / behind / unpublished-bump / version-mismatch.
- **Bulk wizard** — the Choose → Preview → Run flow for [bulk operations](bulk-operations.md): pick an op,
  preview the plan (and, for ripple, a read-only dependency ladder), then run it live.
- **Manifest editor** — add / edit / remove modules with the changes written back to the manifest atomically.
- **Output panel** (bottom) — a tabbed panel: **Output** streams the currently-running command over a
  WebSocket; **Actions** is a rollup of recent operations (running / done / failed); **Log** tails the
  server-side operation log.

## Operations + streaming

Long-running commands (install, build, publish, a bulk run…) are kicked as **operations**. The server runs
them through the same `ProcessRunner` the CLI uses and broadcasts their output over
`/ws/manager/operations`, so the Output panel is a live tail. Only one operation runs at a time per client;
a busy runner returns `409 RunnerBusy`.

## Services

If your manifest declares dev servers / services (the `DevServers` block, or per-module `Service`
descriptors), the generic **ServiceSupervisor** exposes them: the top bar shows a chip for each running
service (click to open it, ✕ to stop). A manifest that declares none simply shows no chips.

## Auth

The web server has an auth seam (`Auth.Enabled` in the manifest, backed by the optional
`orator-authentication` peer). It's off by default — appropriate for a locally-bound tool. Turn it on before
binding to a non-loopback host.
