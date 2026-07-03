# Contributing

Thanks for helping improve retold-monorepo-manager.

## Workflow

1. Branch off `main`.
2. Make your change with a focused commit history.
3. Add or update Mocha TDD coverage for the behavior you touched — every commit should keep
   `npm test` green.
4. Open a pull request against `main`.

## Adding a command

Commands are declarative. To add one:

1. Write an async handler under `source/cli/handlers/` — `module.exports = async function(pContext) { … }`.
   `pContext` gives you `{ Fable, Log, Options, Arguments, ArgumentString, Keyword, Verb, Package, Program }`.
2. Add one entry to `source/cli/MonorepoManager-CommandMap.cjs` (`Keyword`, optional `Verb`,
   `Description`, `Transport`, `Options`, `Handler`).

That is the whole change — the CLI factory generates the command, and (from Phase 4) the web
client reads the same map, so the UI button and the CLI verb stay in lockstep. Set `Transport`
honestly: `native` (CLI and web equivalent), `web-only` (needs a live server / op-id), or
`mode-divergent` (semantics differ by mode).

## Code style

- Tabs for indentation, never spaces.
- Plain JavaScript only — no TypeScript.
- Opening braces on their own line (Allman style).
- Naming: `pVariable` (parameters), `tmpVariable` (locals), `VARIABLE` (constants/globals),
  `libSomething` (imports).
- Match the patterns in the file you are editing.

## Tests

```bash
npm test          # npx mocha -u tdd -R spec test/*_tests.js
```

Test files are named `<Feature>_tests.js`. Suites that need scratch files write them to a
`test/.test_<name>/` directory (gitignored via `.test_*/`) and clean up in `suiteTeardown`.
