# Configuration

Beyond the module list, the **top level** of your `Modules-Manifest.json` carries the tool's own runtime
config. Every key has a sane default, so a minimal manifest (just `Groups`) works out of the box — you only
set what you want to change.

```jsonc
{
  "SchemaVersion": "2.0",
  "Name": "My Ecosystem",

  "GitRemote": "origin",
  "DefaultBranch": "main",
  "Org": "my-org",
  "GitTemplate":  "https://github.com/{org}/{name}.git",
  "DocsTemplate": "https://{org}.github.io/{name}/",

  "EcosystemMembership": { "Mode": "manifest", "Scopes": [] },
  "VersionSource": "highest-in-repo",
  "Ripple": { },

  "Docs":       { "Path": "docs", "Engine": null },
  "DevServers": { },
  "Logging":    { "LogFilePrefix": "Monorepo-Manager-Operations-", "LogDir": ".", "Sink": "file" },
  "Auth":       { "Enabled": false, "Provider": null },
  "WebServer":  { "Port": 44444, "Host": "127.0.0.1" },

  "Groups": [ /* … */ ]
}
```

## Keys

| Key | Default | What it does |
|-----|---------|--------------|
| `SchemaVersion` | — | Informational; the loader only requires a `Groups` array. |
| `Name` | — | Display name of the monorepo. |
| `GitRemote` | `origin` | Remote used for ahead/behind + push/pull. |
| `DefaultBranch` | `main` | Branch assumed when one isn't detected. |
| `Org` / `GitTemplate` / `DocsTemplate` | — | Templates for deriving a module's git + docs URLs from its name. `{org}` and `{name}` are substituted. |
| `EcosystemMembership` | `{ Mode: "manifest" }` | How a dependency is judged "in-ecosystem" for stale-dep checks and ripple edges. See below. |
| `VersionSource` | `highest-in-repo` | Where a module's authoritative version is read from. |
| `Ripple` | `{}` | Ripple action templates + knobs (bump kinds, publish gates). |
| `Docs` | `{ Path: "docs" }` | Where a module's docs live + optional engine. |
| `DevServers` | `{}` | Long-running dev servers/services the **ServiceSupervisor** can start/stop. |
| `Logging` | file sink, `Monorepo-Manager-Operations-` prefix | Operation-log destination. |
| `Auth` | disabled | Optional auth for the web server (peer `orator-authentication`). |
| `WebServer` | `127.0.0.1:44444` | Bind host + port for `mm web` (overridable with `--host` / `--port`). |

## Ecosystem membership

Stale-dependency checks and ripple edges only fire for dependencies that are "in-ecosystem." The default
is **manifest-presence** — a dependency counts if a module by that name exists in the manifest. Retold
packages are unscoped (`pict`, `fable`), so this is the right default. npm-scope prefixes are *additive*:

```jsonc
"EcosystemMembership": {
  "Mode": "manifest",       // "manifest" | "scopes" | "both"
  "Scopes": ["@my-org/"]    // used when Mode is "scopes" or "both"
}
```

The manager never silently excludes a manifest module — `Mode: "scopes"` only *adds* scope-prefixed
packages on top.

## Where config comes from

The web server also reads a small tool-only runtime block from
`source/config/MonorepoManager-Default-Command-Configuration.cjs` (the manifest filename it searches for,
etc.). The keys above live in the **manifest** because they describe *your monorepo*, not the tool.
