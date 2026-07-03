/**
 * MonorepoManager-CommandMap
 *
 * THE single declarative source of truth for every action the tool can perform. The CLI
 * (via MonorepoManager-CommandFactory) and — from Phase 4 on — the web client both read this map,
 * so a UI button and its CLI verb can never drift.
 *
 * One entry per noun (Keyword). A noun with sub-actions lists them in `Verbs[]` (metadata for docs /
 * the web UI, each with its own Transport + Options); the noun's single `Handler` parses the tokens
 * and dispatches. `Transport` records how faithfully CLI and web mirror each other:
 *   'native'         : runs in-process; CLI and web are equivalent.
 *   'web-only'       : needs a live server / WebSocket op-id.
 *   'mode-divergent' : semantics differ by mode (e.g. the publish handshake).
 *
 * Adding a command = one Handler function + one entry here (or one Verb on an existing entry).
 */
const libHandlerHealth = require('./handlers/MonorepoManager-Handler-Health.js');
const libHandlerManifest = require('./handlers/MonorepoManager-Handler-Manifest.js');
const libHandlerStatus = require('./handlers/MonorepoManager-Handler-Status.js');
const libHandlerModule = require('./handlers/MonorepoManager-Handler-Module.js');
const libHandlerAll = require('./handlers/MonorepoManager-Handler-All.js');
const libHandlerPublish = require('./handlers/MonorepoManager-Handler-Publish.js');
const libHandlerWeb = require('./handlers/MonorepoManager-Handler-Web.js');
const libHandlerRipple = require('./handlers/MonorepoManager-Handler-Ripple.js');
const libHandlerBulk = require('./handlers/MonorepoManager-Handler-Bulk.js');

// Reused across most commands.
const OPTION_MANIFEST = { Name: '-m, --manifest <path>', Description: 'Path to a Modules-Manifest.json (default: search upward from cwd).', Default: undefined };

const CommandMap =
[
	{
		Keyword: 'health',
		Description: 'Report the tool version and a summary of the discovered Modules-Manifest.json.',
		Transport: 'native',
		Options: [ OPTION_MANIFEST ],
		Handler: libHandlerHealth
	},

	{
		Keyword: 'web',
		Description: 'Start the web server + WebSocket operation stream (Ctrl-C to stop).',
		Transport: 'native',
		Options:
		[
			OPTION_MANIFEST,
			{ Name: '--port <n>', Description: 'Bind port (default: manifest WebServer.Port or 44444).' },
			{ Name: '--host <addr>', Description: 'Bind host (default: 127.0.0.1).' },
			{ Name: '--open', Description: 'Auto-open the browser.' }
		],
		Handler: libHandlerWeb
	},

	{
		Keyword: 'status',
		Description: 'Show origin-only git status + version state across every module. `status published` also queries npm.',
		Transport: 'native',
		Options: [ OPTION_MANIFEST, { Name: '--dirty-only', Description: 'Only show modules that are dirty or need an action.' }, { Name: '--fetch', Description: 'Reserved: fetch remotes before scanning.' } ],
		Handler: libHandlerStatus.status
	},
	{
		Keyword: 'show',
		Description: 'Deep view of one module: manifest entry, package.json, git status, ecosystem deps.',
		Transport: 'native',
		Options: [ OPTION_MANIFEST ],
		Handler: libHandlerStatus.show
	},

	{
		Keyword: 'run',
		Description: 'Run an npm script in a module: mm run <module> <install|test|types|build|script>.',
		Transport: 'native',
		Options: [ OPTION_MANIFEST ],
		Handler: libHandlerModule.run
	},
	{
		Keyword: 'git',
		Description: 'Origin-only git ops for a module: mm git <module> <pull|push|fetch|diff|log|add|commit>.',
		Transport: 'native',
		Options:
		[
			OPTION_MANIFEST,
			{ Name: '--message <msg>', Description: 'Commit message (for `git <m> commit`).' },
			{ Name: '--all', Description: 'Stage all changes (for `git <m> add`).' },
			{ Name: '--staged', Description: 'Diff staged changes (for `git <m> diff`).' },
			{ Name: '--stat', Description: 'Diffstat only (for `git <m> diff`).' },
			{ Name: '--limit <n>', Description: 'Commit count (for `git <m> log`).' }
		],
		Verbs:
		[
			{ Verb: 'pull', Transport: 'native' }, { Verb: 'push', Transport: 'native' }, { Verb: 'fetch', Transport: 'native' },
			{ Verb: 'diff', Transport: 'native' }, { Verb: 'log', Transport: 'native' }, { Verb: 'add', Transport: 'native' }, { Verb: 'commit', Transport: 'native' }
		],
		Handler: libHandlerModule.git
	},
	{
		Keyword: 'version',
		Description: 'Bump a module version (no git tag): mm version <module> <patch|minor|major|X.Y.Z>.',
		Transport: 'native',
		Options: [ OPTION_MANIFEST ],
		Handler: libHandlerModule.version
	},
	{
		Keyword: 'deps',
		Description: 'Dependency tooling: mm deps <module> ncu [--apply] | mm deps sync [--write].',
		Transport: 'native',
		Options:
		[
			OPTION_MANIFEST,
			{ Name: '--apply', Description: 'Apply ncu updates and reinstall (for `deps <m> ncu`).' },
			{ Name: '--scope <scope>', Description: 'ncu scope: ecosystem | all (default all).' },
			{ Name: '--write', Description: 'Apply dep alignment (for `deps sync`).' }
		],
		Verbs: [ { Verb: 'ncu', Transport: 'native' }, { Verb: 'sync', Transport: 'native' } ],
		Handler: libHandlerModule.deps
	},

	{
		Keyword: 'all',
		Description: 'Repo-wide fan-out: mm all <status|update|install|checkout>.',
		Transport: 'native',
		Options: [ OPTION_MANIFEST ],
		Verbs: [ { Verb: 'status', Transport: 'native' }, { Verb: 'update', Transport: 'native' }, { Verb: 'install', Transport: 'native' }, { Verb: 'checkout', Transport: 'native' } ],
		Handler: libHandlerAll.all
	},

	{
		Keyword: 'publish',
		Description: 'Pre-publish validation + guarded publish: mm publish <check|run> <module> [--yes].',
		Transport: 'mode-divergent',
		Options: [ OPTION_MANIFEST, { Name: '--yes', Description: 'Actually run `npm publish` (for `publish run`).' } ],
		Verbs: [ { Verb: 'check', Transport: 'native' }, { Verb: 'run', Transport: 'mode-divergent' } ],
		Handler: libHandlerPublish.publish
	},

	{
		Keyword: 'ripple',
		Description: 'Dependency graph + ripple: mm ripple <graph|impact|plan|run>.',
		Transport: 'native',
		Options: [ OPTION_MANIFEST, { Name: '--root <module>', Description: 'Limit the graph to a module and its impact cone.' }, { Name: '--json', Description: 'Output the graph as JSON.' }, { Name: '--yes', Description: 'Auto-confirm publish gates (for `ripple run`).' } ],
		Verbs: [ { Verb: 'graph', Transport: 'native' }, { Verb: 'impact', Transport: 'native' }, { Verb: 'plan', Transport: 'native' }, { Verb: 'run', Transport: 'mode-divergent' } ],
		Handler: libHandlerRipple.dispatch
	},

	{
		Keyword: 'bulk',
		Description: 'Bulk operations across modules: mm bulk <plan|run|runs|show> <type> [targets…].',
		Transport: 'native',
		Options:
		[
			OPTION_MANIFEST,
			{ Name: '--yes', Description: 'Auto-confirm gated steps (for confirm-gated ops like ripple-publish).' },
			{ Name: '--kind <kind>', Description: 'Version bump kind (for the version op): patch|minor|major.' },
			{ Name: '--apply', Description: 'Apply updates (for the ncu op).' },
			{ Name: '--scope <scope>', Description: 'ncu scope: ecosystem|all.' },
			{ Name: '--concurrency <n>', Description: 'Parallel targets for flat ops (default 4).' }
		],
		Verbs: [ { Verb: 'plan', Transport: 'native' }, { Verb: 'run', Transport: 'mode-divergent' }, { Verb: 'runs', Transport: 'native' }, { Verb: 'show', Transport: 'native' } ],
		Handler: libHandlerBulk.dispatch
	},

	{
		Keyword: 'manifest',
		Description: 'Manifest hygiene: mm manifest <audit|backfill|reload|migrate>.',
		Transport: 'native',
		Options:
		[
			OPTION_MANIFEST,
			{ Name: '--json', Description: 'JSON output (for `manifest audit`).' },
			{ Name: '--write', Description: 'Apply changes (for `manifest backfill`).' },
			{ Name: '-i, --input <path>', Description: 'v1 manifest to convert (for `manifest migrate`).' },
			{ Name: '-o, --output <path>', Description: 'Output path (for `manifest migrate`).' },
			{ Name: '--default-branch <name>', Description: 'DefaultBranch for the v2 manifest (for `manifest migrate`).' }
		],
		Verbs:
		[
			{ Verb: 'audit', Transport: 'native' }, { Verb: 'backfill', Transport: 'native' },
			{ Verb: 'reload', Transport: 'native' }, { Verb: 'migrate', Transport: 'native' }
		],
		Handler: libHandlerManifest.dispatch
	}
];

module.exports = CommandMap;
