# Overview

`retold-monorepo-manager` manages any monorepo from a single `Modules-Manifest.json`.

## What it does

- **Status** — per-module git status (origin-only: branch, ahead/behind, dirty, next action)
  and local-vs-published npm version, across every module in the manifest.
- **Ripple** — build the inter-module dependency graph, compute blast-radius/impact, and run a
  topologically ordered version-bump + publish cascade with no fork/PR steps.
- **Lifecycle** — per-module `install` / `test` / `build`, version bump, commit, publish
  (with a pre-publish validator), and dependency-update checks.
- **Services** — supervise long-running dev servers / services declared per-module.
- **Manifest hygiene** — audit the manifest against what is on disk, and backfill missing
  entries by discovery.

## Design principles

- **Config-driven, not retold-specific.** No ecosystem names are hardcoded; everything comes
  from the manifest or a small runtime config.
- **One core, two faces.** A transport-agnostic core drives both the CLI and (from Phase 3) the
  web UI. Every UI action has a clean semantic CLI equivalent, declared once in a shared
  command map.
- **Declare-authoritative.** The manifest is the source of truth; discovery only runs on
  explicit `audit` / `backfill` commands.

See [manifest-schema.md](./manifest-schema.md) and [cli-reference.md](./cli-reference.md).
