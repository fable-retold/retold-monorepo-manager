# Phase 5 Design — Bulk Operations (planning vs execution), ripple as one type

> **STATUS: ✅ BUILT & VERIFIED.** Implemented under `source/bulk/` (+ `Api-Bulk`/`Api-Graph`, the
> `#/Bulk` wizard, and `mm ripple`/`mm bulk` CLI verbs). 51 Mocha tests; CLI + web + browser verified.
> This document is the as-built design.


A near-rewrite of the ripple subsystem into two cleanly separated halves, plus a friendly UI:

1. **Planning / "what needs to be done"** — pure computation. A dependency graph + *planners* that
   turn a goal into an ordered plan. Ripple is **one planner**; flat bulk ops are another.
2. **Execution** — a generic **Bulk Operation fable service** that runs any plan: ordered/async
   steps across a set of module *targets*, with confirm gates, live streamed output, per-step state,
   retry-from-failed-step, cancel, and durable run history. Modeled on **ultravisor's** own engine
   (task-type registry + execution manifest + state manager + status enum), **right-sized** — the
   linear-per-target 20% that carries 80% of the value; the visual-flow-graph / beacon-fleet 80% is
   dropped.
3. **UI** — a 3-step **Choose → Preview → Run** wizard so anyone (not just Steven) can drive it.

This replaces retold's `RippleGraph.js` (752 lines, graph+planner conflated) and `Api-Ripple.js`
(1444 lines, executor+transport) — and subsumes Phase 2's `AllModulesRunner` / the Phase 3 `all`
bash-loop routes into one engine. Fork/PR machinery is deleted outright.

---

## 0. The core idea (why this shape)

The old ripple mixed three unrelated concerns in one file. They pull apart at seams that already
exist in the code:

```
                    ┌─────────────────────────── PLANNING (pure, no side effects) ───────────────────────────┐
   modules +        │   GraphSource ──▶ DependencyGraph ──▶  Planner (Ripple | Bulk | …)  ──▶  Plan            │
   package.jsons    │   (adapter)       (pure graph math)     ("what needs to be done")        (ordered steps) │
                    └────────────────────────────────────────────────────────────────────────────┬──────────┘
                                                                                                   │  Plan
                    ┌────────────────────────────── EXECUTION (side effects) ───────────────────────▼──────────┐
                    │   BulkOperation engine  ──drives──▶  Task-type registry  ──▶  ProcessRunner / npm / git   │
                    │   (per-target step loop, state,       (install, test, bump,      + confirm gates + live   │
                    │    retry, cancel, durable manifest)    publish, update-dep, …)     WS output)              │
                    └───────────────────────────────────────────────────────────────────────────────────────────┘
```

- A **Plan** is the contract between the two halves: `{ PlanId, Roots, Graph, Steps:[{Order, Target,
  Kind, Actions:[{Op, …args}]}] }`. The executor never knows which planner produced it; the planner
  never knows what an `Op` *does*.
- A **bulk operation type** (update-all, test-selected, version-bump, ripple-publish, …) is a small
  **data-catalog record** that names a planner + target mode + step template. Adding one is data, not
  code. Ripple-publish is just the entry whose planner is `Planner-Ripple`.

---

## 1. Layer A — the pure dependency graph

`source/bulk/DependencyGraph.js` — **data-in, no fs, no manifest, no policy**. Extracted from
`RippleGraph.js:46–324`, with the retold leaks removed (`GROUP_ORDER` → injected `tieBreak`;
`StopAtApps` → injected `stopWhen`; `LocalLink`/dev-section filters → injected `edgeFilter`).

```js
class DependencyGraph
{
    constructor({ Nodes, Edges })                       // { name -> {Name, Group?} }, [{From,To,Section,Range,LocalLink}]
    dependenciesOf(pName)                               // out-edges  (what this depends on)
    dependentsOf(pName)                                 // in-edges   (what depends on this) — was "ConsumersOf"
    impactOf(pRoots, { edgeFilter, stopWhen })          // BFS blast-radius (transitive dependents)
    topoOrder(pSubset, { tieBreak, edgeFilter })        // Kahn; producers before consumers; deterministic
    subgraph(pNames)                                    // {Nodes, Edges} slice
    findCycles()                                        // real cycle report (promote the topo fallback)
    toVisualizationJSON()                               // {Nodes:[{Name,Group}], Edges:[{From,To,Section,Range}]}
}
```

`source/bulk/GraphSource.js` — the **only** module that touches fs + the manifest. Walks
`ManifestLoader.getAllModules()`, reads each `package.json`, and emits `{ Nodes, Edges }` where an
**edge exists iff a dependency's package name is a manifest module name** (via
`ManifestLoader.isEcosystemDependency` — the manifest-membership semantics locked in Phase 1). This
quarantines all coupling; `DependencyGraph` stays a pure, unit-testable algorithm.

**Reused by:** `mm ripple graph|impact`, the ripple planner, and the read-only graph view in the UI.
This is the "compute the graph" half the user called out as separate.

---

## 2. Layer B — planners ("what needs to be done")

Pure functions: `plan(graph, targets, config) → Plan`. They know **sequencing + which Op names to
string together**, nothing about what an Op does.

**`source/bulk/planners/Planner-Bulk.js`** — the flat planner. Each target gets the same action
chain, independently, in a stable order. Powers update-all / install / test / build / version-bump /
checkout. No graph needed (targets are just the selected set).

**`source/bulk/planners/Planner-Ripple.js`** — the topological planner (the interesting one). From
`buildPlan` (`RippleGraph.js:355–565`), minus the fork branches:
- cone = `roots ∪ graph.impactOf(roots)`;
- `graph.topoOrder(cone)` → producers first;
- per node, synthesize `update-dep` actions for in-cone deps that appear **earlier in the topo order**
  (the crux: it does *not* bake in a version — the executor resolves the concrete version at run time
  so a chain published in one pass sees each freshly-bumped version);
- producer chain: `preflight-clean-tree → bump-if-needed → publish → wait-for-index → commit-final → push`;
- consumer chain: `preflight-clean-tree → update-dep* → install → test → commit → bump → publish → wait-for-index → commit-final → push`.

Key generalizations from retold: `wait-for-index` becomes an **explicit planner-inserted step**
(was a hidden 2-minute side-effect inside publish); `ncu-retold` → generic `ncu` with a scope arg;
`prepare-docs` → an optional configurable "regen" step; `GROUP_ORDER`/`StopAtApps`/
`BringRetoldDepsForward` become plain config (`GroupOrder`, `StopAtGroups`, `RefreshDepsFirst`),
defaulting to neutral.

**The Plan shape** (unchanged from retold — it already works):
```
{ PlanId, Type:'ripple'|'bulk', Roots?:[…], Targets:[…],
  Graph:{ Nodes, Edges },                         // for the UI graph view (ripple only)
  Steps:[ { Order, Target, Kind:'producer'|'consumer'|'flat',
            Actions:[ { Op, …args, RequiresConfirm? } ] } ] }
```

---

## 3. Layer C — the Bulk Operation fable service (execution)

A cohesive subsystem under `source/bulk/`, modeled on ultravisor's engine but **linear-per-target**
instead of event-graph. Five parts, all reusing ultravisor's load-bearing patterns:

### 3a. `BulkOperation-Status.js` — copy ultravisor's `Ultravisor-Status.cjs` verbatim
Canonical run states `Queued → Running → { Waiting ⇄ Running } → Complete | Failed | Cancelled`, and
per-step states `Pending → Running → Complete | Error | Skipped | Retrying`, with `isTerminal` /
`isWaiting` helpers. Self-contained, reusable by the UI's status pills + filter tabs.

### 3b. `BulkOperation-TaskRegistry.js` — the task-type registry (config-driven)
From ultravisor's `registerTaskTypeFromConfig` pattern. A **task type** is `{ Definition, Execute }`:
```
Definition: { Op, Label, Description, RequiresConfirm?, Validator? }
Execute(pContext, pStep, pAction, fCallback)   // fCallback(err, { Outputs?, StateWrites?, Log?, WaitingForInput? })
```
`pContext` gives `{ Target, Module (manifest entry), State (get/set), ProcessRunner, Broadcaster,
RunHash, StepIndex }`. Each retold `runAction` `switch` case (`Api-Ripple.js:319–853`) becomes one
handler. This is the shared vocabulary every planner emits into.

**Reusable task types** (any bulk op can emit): `preflight-clean-tree`, `install`, `test`, `build`,
`commit`, `commit-final`, `bump`, `push`, `publish` (behind the confirm gate).
**Ripple-ish task types** (ship with the ripple planner, engine-registered): `update-dep`
(runtime version-read + atomic `package.json` rewrite — *the resolve-at-run contract, preserved
exactly*), `bump-if-needed`, `wait-for-index`, `ncu`, `regen-docs`.
**Deleted:** `merge-upstream`, `sync-upstream`, `create-pr`, `approve-pr`, `merge-pr` + the
`GitHubPr` import.

Shell task types drive the Phase 2 **`ProcessRunner`** (streamed) so live output flows through the
Phase 3 **`Manager-OperationBroadcaster`** unchanged — one WS transport for both single ops and bulk
steps, correlated by `RunHash` + `StepIndex`.

### 3c. `BulkOperation-StateManager.js` — the three-tier state bag (thin)
Ultravisor's `Global / Operation / Task` address scopes via Manyfest, kept minimal. This is how
`update-dep`'s resolved versions reach the later `commit` step's message, and how per-step outputs
are recorded. No Pict-template expansion, no large-output lifting.

### 3d. `BulkOperation-Manifest.js` — durable run persistence + events
From ultravisor's `ExecutionManifest`: a staging folder per run (`Bulk-<type>-<timestamp>/`), an
in-memory `_Runs` cache, a disk `Manifest.json` **checkpointed after every step and on every pause**
(crash recovery), an append-only `TaskManifests[target].Executions[]` attempt log, `finalize` roll-up,
and `loadRecentManifests()` for history-across-restarts. Emits `TaskStart / TaskComplete / TaskError /
RunComplete` to a **listener registry** — the seam the WS layer + UI subscribe to. `LogDir`/`Sink`
from the manifest config (Phase 1), so history can live on a mounted volume.

### 3e. `BulkOperation-Engine.js` — the runner (a fable service)
The core loop, from `executeRipple` (`Api-Ripple.js:204–317`) but generic and graph-free:
- **run(plan)** → creates a manifest, iterates `Steps` (each = one target's action chain), dispatches
  each `Action.Op` to its task type. Ordered by `Step.Order`; **serial for ripple** (order is the
  point), **bounded-concurrency for flat bulk** (a small pool, config `Concurrency`, default 4) — a
  clean replacement for ultravisor's beacon fan-out.
- **confirm gates** — generalize `runPublishWithConfirm` + the `PreviewHash` handshake into a generic
  "confirm-before-dangerous-step": a task with `RequiresConfirm` runs its `Validator` → the engine
  broadcasts `paused` with the report + hash → parks a promise in `PendingConfirm` → the UI (or CLI
  `--yes`) confirms with the matching hash → the step proceeds. Reused for publish today; available to
  any destructive task tomorrow.
- **retry** — `retryFromCheckpoint`: resume from the failed `(Step, Action)`, preserving prior
  outputs, resetting only the failed node.
- **cancel** — set the cancel flag, reject `PendingConfirm`, `ProcessRunner.kill()`.
- **resume-after-restart** — `resumeWaitingRuns()` re-hydrates `Waiting` runs from disk.
- one bulk run at a time (holds the runner); the Phase 3 `RunnerBusy` 409 gate covers both the
  interactive single ops and a bulk run.

---

## 4. The operation-type catalog (data-driven)

`source/bulk/BulkOperation-Catalog.js` — the picker's source of truth, ultravisor's
`generateCardConfigs` idea minus the SVG:
```js
[
  { Key:'update',        Label:'Update all',        Planner:'bulk',   TargetMode:'all|selected',
    Steps:['pull'],                                  Description:'git pull --rebase each module.' },
  { Key:'install',       Label:'Install',           Planner:'bulk',   Steps:['install'] },
  { Key:'test',          Label:'Test',              Planner:'bulk',   TargetMode:'selected', Steps:['test'] },
  { Key:'build',         Label:'Build',             Planner:'bulk',   Steps:['build'] },
  { Key:'version',       Label:'Bump version',      Planner:'bulk',   Steps:['bump'], Params:['Kind'] },
  { Key:'checkout',      Label:'Clone missing',     Planner:'bulk',   TargetMode:'all', Steps:['checkout'] },
  { Key:'ripple-publish',Label:'Ripple publish',    Planner:'ripple', TargetMode:'roots',
    RequiresConfirm:true, Description:'Bump + publish a module and cascade to every dependent, in order.' }
]
```
The catalog drives the wizard's "Choose" step *and* maps each choice to a planner + step template.
New bulk op = one catalog row (+ task types if novel).

---

## 5. Web API

`source/web_server/routes/Api-Graph.js`
- `GET  /api/manager/graph` → `DependencyGraph.toVisualizationJSON()` (nodes/edges for the graph view).
- `GET  /api/manager/graph/impact/:name` → `{ Impacted:[…], Count }` (blast-radius, no side effects).

`source/web_server/routes/Api-Bulk.js`
- `GET  /api/manager/bulk/catalog` → the operation-type catalog.
- `POST /api/manager/bulk/plan` `{ Type, Targets|Roots, Params }` → a **Plan** (pure; no execution).
- `POST /api/manager/bulk/run` `{ Plan }` → `202 { RunHash }` (execution; streams over WS).
- `GET  /api/manager/bulk/runs` → run history (from the manifest cache).
- `GET  /api/manager/bulk/:id` → run status (steps + states + roll-up).
- `POST /api/manager/bulk/:id/confirm` `{ StepIndex, PreviewHash }` · `/cancel` · `/retry`.

Live frames reuse `/ws/manager/operations` (run/step/output/paused/complete, correlated by `RunHash`).

---

## 6. The UI — Choose → Preview → Run (the care-for-users part)

A new `#/Bulk` workspace + a `Pict-Provider-Manager-Bulk` provider. Reuses the Phase 4 shell, the
`Modal` service, and the WS provider. Borrows ultravisor's run-monitor patterns; **skips** its flow
editor, card SVG, timeline dashboards, typed-value gates, and beacon UI.

**Step 1 — Choose.** Operation type from the catalog (plain-language cards), then targets:
`All` / `Selected` (checkbox list — the module list gains a multi-select mode) / `Auto` (for ripple:
pick root module(s); the impact set is computed). One config table drives the whole picker.

**Step 2 — Preview** (the differentiator ultravisor lacks — the guard rail). Calls `/bulk/plan`
(no side effects) and shows:
- a plain-language summary ("Will run **test** on **7 modules**, in dependency order");
- the ordered step list (module + actions per row), with confirm-required steps badged;
- for ripple, a **read-only dependency graph** (a simple SVG from `toVisualizationJSON`, roots + the
  impact cone highlighted — a legitimate, friendly use of a static graph).
No execution yet. "Run" advances to step 3.

**Step 3 — Run.** A ManifestList-style **live row list** — one row per target/step with a status pill,
driven by CSS-class swaps over the WS (polling fallback). An overall status bar (X of N complete,
elapsed, errors). **Confirm gates** appear inline as a `Modal.confirm({dangerous})` card
("Ready to publish `pict@1.2.0` → npm. [Publish] [Skip]"). On failure, a status-gated **Retry failed**
(with the "poll-and-watch-it-move" reload loop) and **Cancel**. Status strings normalized to a small
canonical set with count-badged filter tabs (`All · Running · Waiting · Complete · Error`).

Design principles carried from ultravisor: views are `pict-view` subclasses (CSS + Templates +
Renderables); all confirms/toasts via the shared `Modal`; live state = class swaps over
WS-with-polling-fallback; friendly relabels, relative time, count badges, consequence-explaining
confirm text.

---

## 7. CLI surface (headless parity — same engine)

- `mm ripple graph [--root <m>] [--json]` — dump the dependency graph / a subgraph.
- `mm ripple impact <m>` — blast-radius (what republishes if `<m>` changes).
- `mm bulk plan <type> [targets…] [--params]` — print the computed plan (dry, no side effects).
- `mm bulk run <type> [targets…] [--yes]` — run it; streams to stdout; `--yes` auto-confirms gates.
- `mm ripple run <m…> [--yes]` — sugar for `mm bulk run ripple-publish <m…>`.
- `mm bulk runs` / `mm bulk show <id>` — history / a past run.

`mm all update|install|…` (Phase 2) becomes sugar over `mm bulk run <type> --all`, so there's one
engine, not two. The CLI confirm-gate is `--yes` (or an interactive prompt); the same engine + planners
run headless and in the web.

---

## 8. Build sub-phases (each shippable + verifiable)

- **5a — Graph.** `DependencyGraph` (pure) + `GraphSource`; `mm ripple graph|impact`; `Api-Graph`.
  Unit tests over a synthetic graph (diamonds, cycles). Verify against retold's real dep graph.
- **5b — Engine + registry + status + manifest.** The execution core with a couple of trivial task
  types (echo/preflight) and a hand-written flat plan; durable manifest + retry/cancel/confirm.
  Tests: run a 2-step plan across 3 scratch git modules, force a failure, retry, cancel.
- **5c — Task types + planners.** Port the reusable + ripple-ish task types; `Planner-Bulk` +
  `Planner-Ripple`; the catalog. Tests: ripple plan over a scratch dependency chain matches expected
  order; flat plan is correct.
- **5d — Web API.** `Api-Bulk` (catalog/plan/run/runs/:id/confirm/cancel/retry) over the engine; WS
  frames. Live-verify plan + run + confirm + retry via curl/WS on the git scratch.
- **5e — UI wizard.** The `#/Bulk` Choose → Preview → Run workspace + run monitor + graph view;
  multi-select on the module list. Browser-verify a flat bulk run and a ripple preview end-to-end.
- **5f — Ripple integration + cleanup.** Wire `mm all` → the engine; delete the old
  `AllModulesRunner`/`all` bash-loop routes; end-to-end ripple-publish dry-run on the scratch chain;
  update docs/plan/memory.

---

## 9. Decisions (locked)

1. **Durable run history — YES.** Reuse ultravisor's manifest pattern: each run checkpoints to disk
   after every step → history list, retry-after-restart, audit trail.
2. **Concurrency — bounded parallel.** Flat bulk ops run with a config `Concurrency` pool (default 4);
   ripple stays strictly **serial** (topological order is the whole point).
3. **Unify `mm all` — YES.** `mm all update|install|…` becomes sugar over `mm bulk run <type> --all`;
   delete `AllModulesRunner` + the Phase 3 `all` bash-loop routes. One executor, one code path.
4. **v1 catalog — expanded.** update / install / test / build / version-bump / clone-missing /
   ripple-publish **plus `deps-align`** (DepAligner as a task) and **`docs-regen`** (per-module docs
   rebuild). Both are catalog rows over the same engine.
