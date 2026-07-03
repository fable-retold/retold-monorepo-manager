# Modules-Manifest.json

The single configuration file the tool runs from. Place it at the monorepo root; `mm` finds it
by walking up from the current directory (override with `--manifest <path>`).

## Top-level keys

| Key | Meaning |
|-----|---------|
| `SchemaVersion` | Manifest schema version (currently `"2.0"`). |
| `Name`, `Description` | Human labels for the monorepo. |
| `RepoRoot` | Repo root; `null` = the manifest's own directory. |
| `GitRemote` | The single git remote all git ops target (default `"origin"`). No upstream/fork model. |
| `DefaultBranch` | Default branch name (default `"main"`). |
| `Org`, `GitTemplate`, `DocsTemplate` | URL synthesis used by `manifest backfill` to fill `GitHub`/`Documentation`. `{org}` and `{name}` are interpolated. |
| `EcosystemMembership` | Which deps count as in-repo for stale-dep checks and ripple edges. `{ Mode: "manifest" \| "scopes" \| "both", Scopes: ["@org/"] }`. **Default `manifest`** = every module named in this file (do not default to scopes). |
| `Ripple` | Dependency-graph ripple config — see below. |
| `VersionSource` | Version-of-truth for `deps sync`: `"highest-in-repo"` (default) \| `"root-package"` \| `"versions-map:<path>"`. |
| `Docs` | `{ Path, Engine }` — docs folder and the command to (re)build it. |
| `Logging` | `{ LogFilePrefix, LogDir, Sink }` — the durable operation transcript. |
| `Auth` | `{ Enabled, Provider }` — off by default; the seam for users later. |
| `WebServer` | `{ Port, Host }` — web mode bind (Phase 3). |
| `Groups[]` | The module groups — see below. |

## `Ripple`

```jsonc
"Ripple": {
  "GroupOrder": [],            // [] = topo tie-break by name; array = declared group precedence
  "ConsumerBump": "patch",
  "ProducerBump": "patch",
  "WaitForIndex": true,        // wait for the npm registry to serve the new version before dependents update
  "ProducerActions": ["preflight-clean-tree","bump-if-needed","publish","wait-for-index","commit-final","push"],
  "ConsumerActions": ["preflight-clean-tree","update-dep","install","test","commit","bump","publish","wait-for-index","commit-final","push"]
}
```

Action chains are config templates — there are **no** fork/PR ops.

## `Groups[]`

```jsonc
{
  "Name": "Pict",
  "Description": "MVC tools",
  "Path": "modules/pict",         // group folder root
  "DiskName": "pict",             // only when the display name differs from the folder
  "Discover": ["*"],              // glob(s) under Path used by audit/backfill (NOT live at read time)
  "ModuleMarker": "package.json", // a dir counts as a module iff it has this file
  "Modules": [ /* module entries */ ]
}
```

## Module entry

```jsonc
{
  "Name": "pict-section-form",
  "Path": "modules/pict/pict-section-form",   // entry Path WINS over the group convention → services in odd folders
  "Type": "library",                           // open enum: library|service|webapp|app|example|tool
  "Description": "…",
  "GitHub": null,                              // string | false (opt out) | null (synthesize on backfill)
  "Documentation": false,
  "DocsPath": "docs",
  "RelatedModules": [],
  "Service": { "Entry": "source/App.js", "Port": 8080, "StartCommand": "npm start" }   // optional
}
```

The `Path` on an entry always wins over the group folder convention — that is what lets a
service living in an arbitrary folder participate without special-casing.
