const libAssert = require('assert');
const libFS = require('fs');
const libPath = require('path');

const libEngine = require('../source/bulk/BulkOperation-Engine.js');
const libManifest = require('../source/bulk/BulkOperation-Manifest.js');
const libRegistry = require('../source/bulk/BulkOperation-TaskRegistry.js');

const _ScratchRoot = libPath.join(__dirname, '.test_bulkengine');

let _failNext = true;

const TASK_TYPES =
[
	{ Definition: { Op: 'echo', Label: 'echo' }, Execute: async (pContext) => { pContext.Log('hello from ' + pContext.Target); return { Outputs: { echoed: true } }; } },
	{ Definition: { Op: 'flaky', Label: 'flaky' }, Execute: async (pContext) => { if (_failNext) { throw new Error('flaky boom'); } pContext.Log('flaky ok'); return {}; } },
	{ Definition: { Op: 'sleep', Label: 'sleep' }, Execute: async (pContext) => { await new Promise((r) => setTimeout(r, 200)); pContext.Log('slept'); return {}; } },
	{ Definition: { Op: 'confirmable', Label: 'confirmable', RequiresConfirm: true, Validator: async () => ({ Ok: true, OkToPublish: true, PreviewHash: 'sha-abc', Problems: [] }) }, Execute: async (pContext) => { pContext.Log('did confirmable on ' + pContext.Target); return {}; } }
];

function stubLoader()
{
	return { getModule: (pName) => ({ Name: pName, AbsolutePath: '/tmp/' + pName, GroupName: 'G' }), ensureLoaded: () => {} };
}

function makeEngine(pEvents)
{
	let tmpManifest = new libManifest({ LogDir: _ScratchRoot });
	let tmpRegistry = new libRegistry().registerAll(TASK_TYPES);
	return new libEngine({ Loader: stubLoader(), Registry: tmpRegistry, Manifest: tmpManifest, OnEvent: (pType, pPayload) => pEvents.push({ Type: pType, Payload: pPayload }), DefaultConcurrency: 2 });
}

function plan(pType, pTargets, pOp)
{
	return { PlanId: 'p', Type: pType, Steps: pTargets.map((pTarget, pIndex) => ({ Order: pIndex, Target: pTarget, Kind: 'flat', Actions: [ { Op: pOp } ] })) };
}

function waitFor(pPredicate, pTimeoutMs)
{
	let tmpDeadline = Date.now() + (pTimeoutMs || 3000);
	return new Promise((pResolve, pReject) =>
	{
		function poll() { if (pPredicate()) { return pResolve(); } if (Date.now() > tmpDeadline) { return pReject(new Error('waitFor timeout')); } setTimeout(poll, 20); }
		poll();
	});
}

suite('BulkOperationEngine',
	() =>
	{
		suiteTeardown(() => { libFS.rmSync(_ScratchRoot, { recursive: true, force: true }); });

		test('runs a flat plan across targets → Complete, all steps Complete',
			async () =>
			{
				let tmpEvents = [];
				let tmpEngine = makeEngine(tmpEvents);
				let tmpHandle = tmpEngine.run(plan('bulk', [ 'a', 'b', 'c' ], 'echo'), {});
				let tmpRun = await tmpHandle.Done;
				libAssert.strictEqual(tmpRun.Status, 'Complete');
				libAssert.strictEqual(tmpRun.Steps.filter((pS) => (pS.Status === 'Complete')).length, 3);
				libAssert.ok(tmpEvents.some((pE) => (pE.Type === 'run-end')));
				libAssert.ok(tmpRun.LogLines.some((pL) => (/hello from a/.test(pL.Text))));
			});

		test('a throwing action fails the step and the run',
			async () =>
			{
				_failNext = true;
				let tmpEngine = makeEngine([]);
				let tmpRun = await tmpEngine.run(plan('bulk', [ 'x' ], 'flaky'), {}).Done;
				libAssert.strictEqual(tmpRun.Status, 'Failed');
				libAssert.strictEqual(tmpRun.Steps[0].Status, 'Error');
				libAssert.strictEqual(tmpRun.Steps[0].Actions[0].Error, 'flaky boom');
			});

		test('retry resumes a failed run and completes when the flake clears',
			async () =>
			{
				_failNext = true;
				let tmpEngine = makeEngine([]);
				let tmpRun = await tmpEngine.run(plan('bulk', [ 'x', 'y' ], 'flaky'), {}).Done;
				libAssert.strictEqual(tmpRun.Status, 'Failed');
				_failNext = false;
				let tmpRetry = await tmpEngine.retry(tmpRun.RunHash);
				let tmpRerun = await tmpRetry.Done;
				libAssert.strictEqual(tmpRerun.Status, 'Complete');
			});

		test('confirm gate pauses the run (Waiting) and resumes on confirm',
			async () =>
			{
				let tmpEvents = [];
				let tmpEngine = makeEngine(tmpEvents);
				let tmpHandle = tmpEngine.run(plan('bulk', [ 'm' ], 'confirmable'), {});
				await waitFor(() => (tmpEvents.some((pE) => (pE.Type === 'paused'))));
				libAssert.strictEqual(tmpEngine.getRun(tmpHandle.RunHash).Status, 'Waiting');
				let tmpConfirm = tmpEngine.confirm(tmpHandle.RunHash, { StepIndex: 0, PreviewHash: 'sha-abc' });
				libAssert.strictEqual(tmpConfirm.Ok, true);
				let tmpRun = await tmpHandle.Done;
				libAssert.strictEqual(tmpRun.Status, 'Complete');
			});

		test('confirm with a stale hash is rejected',
			async () =>
			{
				let tmpEvents = [];
				let tmpEngine = makeEngine(tmpEvents);
				let tmpHandle = tmpEngine.run(plan('bulk', [ 'm' ], 'confirmable'), {});
				await waitFor(() => (tmpEvents.some((pE) => (pE.Type === 'paused'))));
				let tmpBad = tmpEngine.confirm(tmpHandle.RunHash, { StepIndex: 0, PreviewHash: 'wrong' });
				libAssert.strictEqual(tmpBad.Ok, false);
				libAssert.strictEqual(tmpBad.Error, 'PreviewStale');
				tmpEngine.confirm(tmpHandle.RunHash, { StepIndex: 0, PreviewHash: 'sha-abc' });
				await tmpHandle.Done;
			});

		test('cancel stops a running plan → Cancelled',
			async () =>
			{
				let tmpEngine = makeEngine([]);
				let tmpHandle = tmpEngine.run({ PlanId: 'p', Type: 'ripple', Steps: [ 'a', 'b', 'c' ].map((pT, pI) => ({ Order: pI, Target: pT, Kind: 'flat', Actions: [ { Op: 'sleep' } ] })) }, {});
				await new Promise((r) => setTimeout(r, 50));
				tmpEngine.cancel(tmpHandle.RunHash);
				let tmpRun = await tmpHandle.Done;
				libAssert.strictEqual(tmpRun.Status, 'Cancelled');
				libAssert.ok(tmpRun.Steps.filter((pS) => (pS.Status === 'Complete')).length < 3, 'not every step completed');
			});
	});
