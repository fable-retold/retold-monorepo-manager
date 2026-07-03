/**
 * Planner-Ripple — the topological planner ("what needs to be done" for a version cascade).
 *
 * Given the dependency graph + root module(s), computes the impact cone, orders it producers-first,
 * and synthesizes each node's action chain — updating in-cone dependency ranges to versions resolved
 * AT RUN TIME (the ripple laziness). Emits the same Plan shape the flat planner does, so the engine
 * runs both identically. No fork/PR ops.
 */

/**
 * @param {object} pGraph - a DependencyGraph.
 * @param {Array<string>} pRoots - root module(s) whose change should cascade.
 * @param {object} [pConfig] - { ConsumerBump, RunTest, RunPush, WaitForIndex }
 * @returns {object} Plan
 */
function planRipple(pGraph, pRoots, pConfig)
{
	let tmpConfig = pConfig || {};
	let tmpRoots = pRoots.slice();
	let tmpCone = tmpRoots.concat(pGraph.impactOf(tmpRoots, {}));
	let tmpOrder = pGraph.topoOrder(tmpCone, {}); // producers first

	let tmpEarlier = new Set();
	let tmpSteps = [];

	for (let i = 0; i < tmpOrder.length; i++)
	{
		let tmpName = tmpOrder[i];
		let tmpIsRoot = tmpRoots.indexOf(tmpName) >= 0;
		let tmpActions = [];

		tmpActions.push({ Op: 'preflight-clean-tree' });

		// Update dependency ranges for in-cone deps already processed earlier in the order.
		let tmpUpdateDeps = pGraph.dependenciesOf(tmpName).filter((pDep) => (tmpEarlier.has(pDep)));
		for (let d = 0; d < tmpUpdateDeps.length; d++)
		{
			tmpActions.push({ Op: 'update-dep', Dep: tmpUpdateDeps[d], Section: 'dependencies', RangePrefix: '^' });
		}
		if (tmpUpdateDeps.length > 0)
		{
			tmpActions.push({ Op: 'install' });
			if (tmpConfig.RunTest !== false) { tmpActions.push({ Op: 'test' }); }
			tmpActions.push({ Op: 'commit' });
		}

		if (tmpIsRoot) { tmpActions.push({ Op: 'bump-if-needed' }); }
		else { tmpActions.push({ Op: 'bump', Kind: tmpConfig.ConsumerBump || 'patch' }); }

		tmpActions.push({ Op: 'publish', RequiresConfirm: true, ConfirmPrompt: 'Publish ' + tmpName + ' to npm?' });
		if (tmpConfig.WaitForIndex !== false) { tmpActions.push({ Op: 'wait-for-index' }); }
		tmpActions.push({ Op: 'commit-final' });
		if (tmpConfig.RunPush !== false) { tmpActions.push({ Op: 'push' }); }

		tmpSteps.push({ Order: i, Target: tmpName, Kind: tmpIsRoot ? 'producer' : 'consumer', Actions: tmpActions });
		tmpEarlier.add(tmpName);
	}

	return {
		PlanId: 'plan-ripple-' + Date.now(),
		Type: 'ripple',
		Roots: tmpRoots,
		Targets: tmpOrder,
		Graph: pGraph.subgraph(tmpCone),
		Steps: tmpSteps
	};
}

module.exports = { planRipple };
