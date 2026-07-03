/**
 * BulkOperation-Catalog — the data-driven list of operation types (ultravisor's card-config idea,
 * minus the SVG). Drives the wizard's "Choose" step and maps each choice to a planner + step template.
 * Adding a bulk operation = one row here (+ a task type if it uses a novel Op).
 *
 * TargetMode: 'all' | 'selected' | 'roots' | 'none'   RequiresConfirm: gates before running.
 */
module.exports =
[
	{ Key: 'update', Label: 'Update all', Planner: 'bulk', TargetMode: 'all', Steps: [ 'pull' ], Description: 'git pull --rebase in each module.' },
	{ Key: 'install', Label: 'Install', Planner: 'bulk', TargetMode: 'all', Steps: [ 'install' ], Description: 'npm install in each module.' },
	{ Key: 'test', Label: 'Test', Planner: 'bulk', TargetMode: 'selected', Steps: [ 'test' ], Description: 'npm test in each selected module.' },
	{ Key: 'build', Label: 'Build', Planner: 'bulk', TargetMode: 'selected', Steps: [ 'build' ], Description: 'npm run build in each selected module.' },
	{ Key: 'version', Label: 'Bump version', Planner: 'bulk', TargetMode: 'selected', Steps: [ 'bump' ], Params: [ 'Kind' ], Description: 'npm version <kind> in each selected module.' },
	{ Key: 'checkout', Label: 'Clone missing', Planner: 'bulk', TargetMode: 'all', Steps: [ 'checkout' ], Description: 'git clone any module not yet on disk.' },
	{ Key: 'docs-regen', Label: 'Regenerate docs', Planner: 'bulk', TargetMode: 'selected', Steps: [ 'regen-docs' ], Description: "Rebuild each selected module's docs." },
	{ Key: 'deps-align', Label: 'Align ecosystem deps', Planner: 'align', TargetMode: 'none', Steps: [ 'deps-align' ], Description: 'Align every in-repo dependency range to the version source.' },
	{ Key: 'ripple-publish', Label: 'Ripple publish', Planner: 'ripple', TargetMode: 'roots', RequiresConfirm: true, Description: 'Bump + publish a module and cascade to every dependent, in dependency order.' }
];
