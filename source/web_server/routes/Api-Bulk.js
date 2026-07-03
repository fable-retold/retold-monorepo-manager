/**
 * Api-Bulk — the bulk-operation surface: the operation catalog, planning (pure), running (streams
 * over WS as bulk-* frames), run history + status, and the confirm/cancel/retry lifecycle.
 */
const libPlanners = require('../../bulk/Planners.js');

function respondError(pRes, pStatus, pCode, pMessage)
{
	pRes.statusCode = pStatus;
	pRes.send({ Error: pCode, Message: pMessage });
}

module.exports = function registerBulkRoutes(pCore)
{
	let tmpOrator = pCore.Orator;
	let tmpLoader = pCore.Loader;
	let tmpEngine = pCore.BulkEngine;

	// The operation-type catalog (drives the wizard's Choose step).
	tmpOrator.serviceServer.doGet('/api/manager/bulk/catalog', function (pReq, pRes, pNext)
		{
			pRes.send({ Catalog: libPlanners.catalog });
			return pNext();
		});

	// Run history.
	tmpOrator.serviceServer.doGet('/api/manager/bulk/runs', function (pReq, pRes, pNext)
		{
			pRes.send({ Runs: tmpEngine.listRuns() });
			return pNext();
		});

	// Compute a plan (no side effects) — for the wizard's Preview step.
	tmpOrator.serviceServer.doPost('/api/manager/bulk/plan', function (pReq, pRes, pNext)
		{
			let tmpBody = pReq.body || {};
			try
			{
				let tmpPlan = libPlanners.buildPlan(tmpBody.Type, { Targets: tmpBody.Targets, Roots: tmpBody.Roots, Params: tmpBody.Params }, tmpLoader);
				pRes.send(tmpPlan);
			}
			catch (pError) { respondError(pRes, 400, 'PlanFailed', pError.message); }
			return pNext();
		});

	// Run a plan (streams over the WS). Accepts a pre-built Plan or a { Type, Targets/Roots, Params }.
	tmpOrator.serviceServer.doPost('/api/manager/bulk/run', function (pReq, pRes, pNext)
		{
			let tmpBody = pReq.body || {};
			let tmpPlan;
			try
			{
				tmpPlan = tmpBody.Plan || libPlanners.buildPlan(tmpBody.Type, { Targets: tmpBody.Targets, Roots: tmpBody.Roots, Params: tmpBody.Params }, tmpLoader);
			}
			catch (pError) { respondError(pRes, 400, 'PlanFailed', pError.message); return pNext(); }

			if (tmpEngine.hasActiveRun()) { respondError(pRes, 409, 'RunnerBusy', 'A bulk operation is already running.'); return pNext(); }

			try
			{
				let tmpHandle = tmpEngine.run(tmpPlan, { AutoConfirm: tmpBody.AutoConfirm === true, Concurrency: tmpBody.Concurrency });
				pRes.statusCode = 202;
				pRes.send({ RunHash: tmpHandle.RunHash, Type: tmpPlan.Type, StepCount: tmpPlan.Steps.length });
			}
			catch (pError) { respondError(pRes, 409, 'RunFailed', pError.message); }
			return pNext();
		});

	// Run status.
	tmpOrator.serviceServer.doGet('/api/manager/bulk/:id', function (pReq, pRes, pNext)
		{
			let tmpRun = tmpEngine.getRun(pReq.params.id);
			if (!tmpRun) { respondError(pRes, 404, 'UnknownRun', 'No such run.'); return pNext(); }
			pRes.send(tmpRun);
			return pNext();
		});

	tmpOrator.serviceServer.doPost('/api/manager/bulk/:id/confirm', function (pReq, pRes, pNext)
		{
			let tmpBody = pReq.body || {};
			let tmpResult = tmpEngine.confirm(pReq.params.id, { StepIndex: tmpBody.StepIndex, PreviewHash: tmpBody.PreviewHash, Skip: tmpBody.Skip === true });
			if (!tmpResult.Ok) { respondError(pRes, 409, tmpResult.Error || 'ConfirmFailed', 'Could not confirm.'); return pNext(); }
			pRes.send({ Ok: true });
			return pNext();
		});

	tmpOrator.serviceServer.doPost('/api/manager/bulk/:id/cancel', function (pReq, pRes, pNext)
		{
			let tmpResult = tmpEngine.cancel(pReq.params.id);
			if (!tmpResult.Ok) { respondError(pRes, 404, tmpResult.Error || 'CancelFailed', 'Could not cancel.'); return pNext(); }
			pRes.send({ Ok: true });
			return pNext();
		});

	tmpOrator.serviceServer.doPost('/api/manager/bulk/:id/retry', function (pReq, pRes, pNext)
		{
			try
			{
				let tmpHandle = tmpEngine.retry(pReq.params.id);
				pRes.statusCode = 202;
				pRes.send({ RunHash: tmpHandle.RunHash });
			}
			catch (pError) { respondError(pRes, 409, 'RetryFailed', pError.message); }
			return pNext();
		});
};
