# CLI reference

> This page will be **generated** from `source/cli/MonorepoManager-CommandMap.cjs` (Phase 6) so
> it can never go stale. Below is the current + planned grammar.

Grammar: `mm <noun> <verb> [target] [--options]`. `mm` finds the manifest by walking up from the
current directory; override with `--manifest <path>`.

## Available now (Phases 0–2, headless CLI)

```
STATUS      mm health [--manifest <path>]
            mm status [published] [--dirty-only]
            mm show <module>
LIFECYCLE   mm run <module> <install|test|types|build|script>
            mm version <module> <patch|minor|major|X.Y.Z>
            mm publish check <module>
            mm publish run <module> --yes           (mode-divergent: revalidates + recomputes hash)
GIT         mm git <module> pull|push|fetch                     (origin only)
            mm git <module> diff [--staged] [--stat]
            mm git <module> log [--limit N]
            mm git <module> add [--all | <paths...>]
            mm git <module> commit --message "<msg>"
DEPS        mm deps <module> ncu [--apply] [--scope ecosystem|all]
            mm deps sync [--write]
REPO-WIDE   mm all status|update|install|checkout
MANIFEST    mm manifest audit [--json]
            mm manifest backfill [--write]
            mm manifest reload
            mm manifest migrate --input <v1-manifest> [--output <path>] [--write] [--default-branch <name>]
```

Every command is declared in `source/cli/MonorepoManager-CommandMap.cjs`; its `Transport` tag records
whether the CLI and (future) web forms are equivalent (`native`), the action needs a live server
(`web-only`), or the two modes differ (`mode-divergent`, e.g. `publish run`).

## Planned (Phases 3–5, with the web server + ripple engine)

```
SERVE       mm web [--port N]
DOCS/SVC    mm docs regen <m> · mm docs serve|edit <m> · mm service <m> start|stop|status
RIPPLE      mm ripple graph [--root <m>] [--json] · mm ripple impact <m> [--depth N]
            mm ripple plan <m…> [--dry] · mm ripple run <m…> [--yes] · mm ripple resume|cancel <id>
MANIFEST+   mm manifest group add|remove <name> · mm manifest module move <name> --to-group G
FILES/OPS   mm files <m> ls|cat <path> · mm search <q> · mm ops tail|cancel <id> · mm log [--tail N]
```
