# CLI Reference

Both bin names — `monorepo-manager` and the short alias **`mm`** — accept the same commands. Every command
takes the global `-m, --manifest <path>` option; without it, the manifest is found by walking up from the
current directory.

```
mm <command> [subcommand] [module] [options]
```

## Inspect

### `mm health`
Report the tool version and a summary of the discovered `Modules-Manifest.json` (name, schema, group +
module counts).

### `mm status [published]`
Origin-only git status + version state across every module. `mm status published` also queries npm for each
module's published version.

- `--dirty-only` — only show modules that are dirty or need an action.
- `--fetch` — *(reserved)* fetch remotes before scanning.

### `mm show <module>`
Deep view of one module: its manifest entry, `package.json`, git status, and categorized (ecosystem vs
external) dependencies.

## Act on a module

### `mm run <module> <install|test|types|build|script>`
Run an npm script (or `install`) in a module, streaming its output.

### `mm git <module> <pull|push|fetch|diff|log|add|commit>`
Origin-only git operations for a module.

- `--message <msg>` — commit message (for `git <m> commit`).
- `--all` — stage all changes (for `git <m> add`).
- `--staged` — diff staged changes; `--stat` — diffstat only (for `git <m> diff`).
- `--limit <n>` — commit count (for `git <m> log`).

### `mm version <module> <patch|minor|major|X.Y.Z>`
Bump a module's version (no git tag).

### `mm deps <module> ncu` · `mm deps sync`
Dependency tooling. `deps <m> ncu` checks for outdated dependencies; `deps sync` aligns shared deps across
the ecosystem.

- `--apply` — apply ncu updates and reinstall (for `deps <m> ncu`).
- `--scope <ecosystem|all>` — ncu scope (default `all`).
- `--write` — apply dep alignment (for `deps sync`).

## Publish

### `mm publish <check|run> <module>`
Pre-publish validation + a guarded publish. `publish check` validates only; `publish run` publishes.

- `--yes` — actually run `npm publish` (for `publish run`).

## Whole-repo

### `mm all <status|update|install|checkout>`
Repo-wide fan-out of a lifecycle action across every module.

### `mm ripple <graph|impact|plan|run>`
Dependency graph + the topological ripple. `graph` prints the graph; `impact` shows a module's blast radius;
`plan` produces an ordered version-bump + publish plan; `run` executes it behind confirm-gates. See
[Bulk Operations &amp; Ripple](bulk-operations.md).

- `--root <module>` — limit the graph to a module and its impact cone.
- `--json` — output the graph as JSON.
- `--yes` — auto-confirm publish gates (for `ripple run`).

### `mm bulk <plan|run|runs|show> <type> [targets…]`
Run a named bulk operation across modules (`update`, `test`, `build`, `version`, `ncu`, `ripple-publish`,
…). `plan` previews; `run` executes; `runs` lists past runs; `show <id>` inspects one. See
[Bulk Operations &amp; Ripple](bulk-operations.md).

- `--yes` — auto-confirm gated steps (e.g. ripple-publish).
- `--kind <patch|minor|major>` — version-bump kind (for the version op).
- `--apply` / `--scope <ecosystem|all>` — for the ncu op.
- `--concurrency <n>` — parallel targets for flat ops (default 4).

## Manifest hygiene

### `mm manifest <audit|backfill|reload|migrate>`
Keep the manifest honest. `audit` compares it to disk; `backfill` adds missing entries by discovery;
`reload` re-reads it; `migrate` converts a legacy/v1 manifest to the v2 schema.

- `--json` — JSON output (for `manifest audit`).
- `--write` — apply changes (for `manifest backfill`).
- `-i, --input <path>` / `-o, --output <path>` — for `manifest migrate`.
- `--default-branch <name>` — `DefaultBranch` for the generated v2 manifest.

## Web

### `mm web`
Start the web server + WebSocket operation stream (Ctrl-C to stop). See [Web Interface](web-interface.md).

- `--port <n>` — bind port (default: manifest `WebServer.Port` or 44444).
- `--host <addr>` — bind host (default: `127.0.0.1`).
- `--open` — auto-open the browser.
