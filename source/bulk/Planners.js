/**
 * Planners — the entry point that turns an operation-type choice into a Plan. Dispatches to the
 * ripple planner (graph-driven), the flat bulk planner, or the one-step deps-align plan.
 */
const libCatalog = require('./BulkOperation-Catalog.js');
const libPlannerBulk = require('./planners/Planner-Bulk.js');
const libPlannerRipple = require('./planners/Planner-Ripple.js');
const libGraphSource = require('./GraphSource.js');

function catalogEntry(pKey)
{
	return libCatalog.find((pEntry) => (pEntry.Key === pKey)) || null;
}

function resolveTargets(pEntry, pRequest, pLoader)
{
	if (pEntry.TargetMode === 'all') { return pLoader.getAllModuleNames(); }
	if (pEntry.TargetMode === 'none') { return []; }
	return (pRequest.Targets && pRequest.Targets.length) ? pRequest.Targets : (pRequest.Roots || []);
}

/**
 * @param {string|object} pKeyOrEntry - a catalog Key or a catalog entry.
 * @param {object} pRequest - { Targets?, Roots?, Params? }
 * @param {object} pLoader - a loaded ManifestLoader.
 * @returns {object} Plan
 */
function buildPlan(pKeyOrEntry, pRequest, pLoader)
{
	let tmpEntry = (typeof pKeyOrEntry === 'string') ? catalogEntry(pKeyOrEntry) : pKeyOrEntry;
	if (!tmpEntry) { throw new Error('Unknown bulk operation type: ' + pKeyOrEntry); }
	let tmpRequest = pRequest || {};
	let tmpPlan;

	if (tmpEntry.Planner === 'ripple')
	{
		let tmpRoots = (tmpRequest.Roots && tmpRequest.Roots.length) ? tmpRequest.Roots : (tmpRequest.Targets || []);
		if (!tmpRoots.length) { throw new Error('ripple-publish needs at least one root module'); }
		tmpRoots.forEach((pRoot) => { if (!pLoader.getModule(pRoot)) { throw new Error('Unknown module: ' + pRoot); } });
		let tmpGraph = libGraphSource.buildGraph(pLoader);
		tmpPlan = libPlannerRipple.planRipple(tmpGraph, tmpRoots, (pLoader.getConfig().Ripple) || {});
	}
	else if (tmpEntry.Planner === 'align')
	{
		tmpPlan = { PlanId: 'plan-align-' + Date.now(), Type: 'bulk', Targets: [ '(repo)' ], Steps: [ { Order: 0, Target: '(repo)', Kind: 'flat', Actions: [ { Op: 'deps-align' } ] } ] };
	}
	else
	{
		let tmpTargets = resolveTargets(tmpEntry, tmpRequest, pLoader);
		if (!tmpTargets.length) { throw new Error(tmpEntry.Label + ' needs at least one target module'); }
		tmpTargets.forEach((pTarget) => { if (!pLoader.getModule(pTarget)) { throw new Error('Unknown module: ' + pTarget); } });
		tmpPlan = libPlannerBulk.planBulk(tmpTargets, tmpEntry.Steps, tmpRequest.Params || {});
	}

	tmpPlan.OperationKey = tmpEntry.Key;
	tmpPlan.Label = tmpEntry.Label;
	return tmpPlan;
}

module.exports = { buildPlan, catalog: libCatalog, catalogEntry };
