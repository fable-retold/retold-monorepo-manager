/**
 * Handlers: `mm ripple graph [--root <m>] [--json]` and `mm ripple impact <module>`.
 * (Phase 5a — the pure graph/planning surface. `plan`/`run` land with the bulk engine.)
 */
const libSupport = require('./MonorepoManager-Handler-Support.js');
const libGraphSource = require('../../bulk/GraphSource.js');
const libHandlerBulk = require('./MonorepoManager-Handler-Bulk.js');

async function graph(pContext)
{
	let tmpLoader = libSupport.loaderFromContext(pContext);
	let tmpGraph = libGraphSource.buildGraph(tmpLoader);
	let tmpOptions = pContext.Options || {};

	let tmpNames;
	if (tmpOptions.root)
	{
		if (!tmpLoader.getModule(tmpOptions.root)) { console.error(`Unknown module: ${tmpOptions.root}`); process.exitCode = 1; return; }
		tmpNames = [ tmpOptions.root ].concat(tmpGraph.impactOf([ tmpOptions.root ], {}));
	}
	else
	{
		tmpNames = tmpGraph.nodeNames();
	}

	if (tmpOptions.json)
	{
		console.log(JSON.stringify(tmpGraph.subgraph(tmpNames), null, 2));
		return;
	}

	let tmpOrder = tmpGraph.topoOrder(tmpNames, {});
	console.log(`${tmpNames.length} modules, ${tmpGraph.subgraph(tmpNames).Edges.length} edges${tmpOptions.root ? ` (cone of ${tmpOptions.root})` : ''}`);
	console.log('');
	console.log('Dependency order (producers first):');
	for (let i = 0; i < tmpOrder.length; i++)
	{
		let tmpDeps = tmpGraph.dependenciesOf(tmpOrder[i]).filter((pDep) => (tmpNames.indexOf(pDep) >= 0));
		console.log(`  ${i + 1}. ${tmpOrder[i]}${tmpDeps.length ? '  → ' + tmpDeps.join(', ') : ''}`);
	}
	let tmpCycles = tmpGraph.findCycles();
	if (tmpCycles.length > 0) { console.log(`\n⚠ cycle(s) involving: ${tmpCycles.join(', ')}`); }
}

async function impact(pContext)
{
	let tmpArguments = pContext.Arguments || [];
	let tmpName = tmpArguments[0];
	if (!tmpName) { console.error('Usage: mm ripple impact <module>'); process.exitCode = 1; return; }

	let tmpLoader = libSupport.loaderFromContext(pContext);
	if (!tmpLoader.getModule(tmpName)) { console.error(`Unknown module: ${tmpName}`); process.exitCode = 1; return; }

	let tmpGraph = libGraphSource.buildGraph(tmpLoader);
	let tmpImpacted = tmpGraph.impactOf([ tmpName ], {});
	let tmpOrdered = tmpGraph.topoOrder([ tmpName ].concat(tmpImpacted), {}).filter((pName) => (pName !== tmpName));

	console.log(`Changing ${tmpName} impacts ${tmpImpacted.length} module(s)${tmpImpacted.length ? ' (republish order):' : '.'}`);
	for (let i = 0; i < tmpOrdered.length; i++) { console.log(`  ${i + 1}. ${tmpOrdered[i]}`); }
	if (tmpImpacted.length === 0) { console.log('  (nothing depends on it)'); }
}

async function dispatch(pContext)
{
	let tmpArguments = pContext.Arguments || [];
	let tmpVerb = tmpArguments[0];
	let tmpRest = tmpArguments.slice(1);
	if (tmpVerb === 'graph') { return graph(pContext); }
	if (tmpVerb === 'impact') { return impact(Object.assign({}, pContext, { Arguments: tmpRest })); }
	// `ripple plan|run <roots…>` is sugar for the ripple-publish bulk operation.
	if (tmpVerb === 'plan') { return libHandlerBulk.planFor(pContext, 'ripple-publish', tmpRest); }
	if (tmpVerb === 'run') { return libHandlerBulk.runFor(pContext, 'ripple-publish', tmpRest); }
	console.error('Usage: mm ripple <graph [--root <m>] | impact <module> | plan <roots…> | run <roots…> [--yes]>');
	process.exitCode = 1;
}

module.exports = { dispatch, graph, impact };
