/**
 * Planner-Bulk — the flat planner. Each target gets the same action chain, independently. Powers
 * update / install / test / build / version / checkout / docs-regen. No graph needed.
 */
function buildAction(pOp, pParams)
{
	let tmpAction = { Op: pOp };
	if (pOp === 'bump') { tmpAction.Kind = pParams.Kind || 'patch'; }
	if (pOp === 'ncu') { tmpAction.Apply = !!pParams.Apply; tmpAction.Scope = pParams.Scope || 'all'; }
	if (pOp === 'commit' && pParams.Message) { tmpAction.Message = pParams.Message; }
	return tmpAction;
}

/**
 * @param {Array<string>} pTargets - module names.
 * @param {Array<string>} pSteps - ordered op names to run per target.
 * @param {object} [pParams]
 * @returns {object} Plan
 */
function planBulk(pTargets, pSteps, pParams)
{
	let tmpParams = pParams || {};
	return {
		PlanId: 'plan-bulk-' + Date.now(),
		Type: 'bulk',
		Targets: pTargets.slice(),
		Steps: pTargets.map((pTarget, pIndex) =>
			({
				Order: pIndex,
				Target: pTarget,
				Kind: 'flat',
				Actions: pSteps.map((pOp) => (buildAction(pOp, tmpParams)))
			}))
	};
}

module.exports = { planBulk, buildAction };
