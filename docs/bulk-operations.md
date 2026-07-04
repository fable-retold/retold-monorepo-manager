# Bulk Operations &amp; Ripple

Doing one thing to one module is `mm run` / `mm git` / `mm version`. Doing *planned* work across **many**
modules — a repo-wide test sweep, a dependency-update pass, or the topologically-ordered publish cascade —
is the **bulk-operation subsystem**.

It cleanly separates two concerns:

- **Planning** — pure, data-in/data-out. A `DependencyGraph` (built from the manifest) + a **planner**
  produces an ordered **plan**: `{ Steps: [ { Order, Target, Actions: [ … ] } ] }`. Nothing runs yet.
- **Execution** — a generic **engine** walks the plan target-by-target with a durable checkpoint, confirm
  gates, retry-from-failed, and bounded parallelism.

## Ripple

Ripple is the flagship plan: when you publish a module, everything that depends on it (transitively) needs
a version bump + republish, in dependency order. The `ripple` command surfaces each stage:

```bash
mm ripple graph                     # the inter-module dependency graph
mm ripple impact --root fable       # the blast radius of changing `fable`
mm ripple plan                      # an ordered bump + publish plan (nothing runs)
mm ripple run                       # execute it, pausing at each publish gate
mm ripple run --yes                 # …auto-confirm the gates
```

`impact` and `plan` are read-only; `run` is the only mutating verb, and every publish is a confirm-gate.

## Bulk

`mm bulk` runs any op in the catalog across a set of targets (or the whole repo):

```bash
mm bulk plan test                          # preview: which modules, in what order
mm bulk run test                           # run it (bounded parallelism, default 4)
mm bulk run version --kind minor pict fable
mm bulk run ripple-publish --yes           # the ripple, as a bulk op
mm bulk runs                               # list past runs (with their durable ids)
mm bulk show <run-id>                      # inspect one run
```

The catalog includes flat sweeps (`update`, `install`, `test`, `build`, `version`, `ncu`, deps-align) and
the topological `ripple-publish`. Flat ops run with bounded parallelism (`--concurrency`, default 4); ripple
runs serially in dependency order.

## What makes a run safe

- **Durable checkpoints.** Every run records its plan + per-step state to a run manifest under the
  monorepo (`.monorepo-manager-runs/`). A run you can list with `mm bulk runs` and inspect with
  `mm bulk show`.
- **Confirm gates.** Dangerous steps (any publish) pause for confirmation — a typed/clicked gate on the
  CLI, the same handshake in the web wizard. `--yes` opts out.
- **Retry from failed.** A run that fails part-way can resume from the failed step rather than from the top.
- **Preview first.** `plan` (CLI) and the wizard's Preview step show the full ordered plan — and, for
  ripple, a read-only dependency ladder — before anything executes.

## In the web UI

The same engine drives the **Choose → Preview → Run** wizard: pick an operation, review the plain-language
plan (plus the dependency ladder for ripple), then run it with output streaming into the bottom panel. See
[Web Interface](web-interface.md).
