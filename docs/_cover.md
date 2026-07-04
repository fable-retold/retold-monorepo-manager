# Monorepo Manager

> Config-driven monorepo manager — one `Modules-Manifest.json`, a headless CLI, and a web UI.

- Point it at **any** monorepo — modules in subfolders, a docs folder, scattered `package.json`s, services in odd places
- Per-module **git status** (origin-only) + **local-vs-published npm** versions across the whole tree
- Dependency-graph **ripple**: blast-radius, impact cones, and topologically-ordered version-bump + publish cascades
- **Bulk operations** — planned, gated, resumable sweeps (update / test / build / publish) with a Choose → Preview → Run wizard
- **One core, two faces** — the CLI and the web UI share a single command map, so every UI action has a clean CLI equivalent
- Runs anywhere: `npx mm`, a local web server, or a Docker image with your monorepo bind-mounted

[GitHub](https://github.com/fable-retold/retold-monorepo-manager)
[Get Started](quickstart.md)
