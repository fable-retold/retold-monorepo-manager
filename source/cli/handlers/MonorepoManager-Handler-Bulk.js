/**
 * Handlers: `mm bulk <plan|run|runs|show>` — the headless face of the bulk-operation engine.
 * (Also reused by `mm ripple plan|run` and, in Phase 5f, by `mm all`.)
 */
const libSupport = require('./MonorepoManager-Handler-Support.js');
const libPlanners = require('../../bulk/Planners.js');
const libBulkFactory = require('../../bulk/BulkOperation-Factory.js');
const libManifest = require('../../bulk/BulkOperation-Manifest.js');
const libPrePublishValidator = require('../../core/Manager-Core-PrePublishValidator.js');

function paramsFromOptions(pOptions)
{
	let tmpOptions = pOptions || {};
	return { Kind: tmpOptions.kind, Apply: !!tmpOptions.apply, Scope: tmpOptions.scope, Message: tmpOptions.message };
}

function printPlan(pPlan)
{
	console.log(`Plan: ${pPlan.Label || pPlan.Type} — ${pPlan.Steps.length} step(s)${pPlan.Type === 'ripple' ? ', dependency order' : ''}`);
	pPlan.Steps.forEach((pStep) =>
		{
			console.log(`  ${pStep.Order + 1}. ${pStep.Target} [${pStep.Kind}]  →  ${pStep.Actions.map((pA) => (pA.Op)).join(' · ')}`);
		});
}

function cliEventPrinter()
{
	return function (pType, pPayload)
	{
		if (pType === 'step-start') { console.log(`\n── ${pPayload.Target} ──`); }
		else if (pType === 'output') { process.stdout.write((pPayload.Text || '') + '\n'); }
		else if (pType === 'action-end' && pPayload.Status === 'Error') { console.log(`  ✗ ${pPayload.Op}: ${pPayload.Error || ''}`); }
	};
}

/** Shared by `mm bulk plan` and `mm ripple plan`. */
async function planFor(pContext, pType, pArgs)
{
	let tmpLoader = libSupport.loaderFromContext(pContext);
	try
	{
		let tmpPlan = libPlanners.buildPlan(pType, { Targets: pArgs, Roots: pArgs, Params: paramsFromOptions(pContext.Options) }, tmpLoader);
		printPlan(tmpPlan);
	}
	catch (pError) { console.error(pError.message); process.exitCode = 1; }
}

/** Shared by `mm bulk run` and `mm ripple run`. */
async function runFor(pContext, pType, pArgs)
{
	let tmpLoader = libSupport.loaderFromContext(pContext);
	let tmpOptions = pContext.Options || {};

	let tmpPlan;
	try { tmpPlan = libPlanners.buildPlan(pType, { Targets: pArgs, Roots: pArgs, Params: paramsFromOptions(tmpOptions) }, tmpLoader); }
	catch (pError) { console.error(pError.message); process.exitCode = 1; return; }

	let tmpGated = tmpPlan.Steps.some((pStep) => (pStep.Actions.some((pAction) => (pAction.RequiresConfirm))));
	if (tmpGated && !tmpOptions.yes)
	{
		printPlan(tmpPlan);
		console.error('\nThis plan includes confirm-gated steps (e.g. publish). Re-run with --yes to execute (auto-confirming each), or use the web UI to confirm interactively.');
		process.exitCode = 1;
		return;
	}

	let tmpIntrospector = libSupport.introspectorFromContext(tmpLoader);
	let tmpValidator = new libPrePublishValidator({ introspector: tmpIntrospector, ManifestLoader: tmpLoader });
	let tmpEngine = libBulkFactory.createEngine(
		{
			Loader: tmpLoader, Introspector: tmpIntrospector, Validator: tmpValidator,
			LogDir: tmpLoader.getRepoRoot(), OnEvent: cliEventPrinter(),
			DefaultConcurrency: tmpOptions.concurrency ? parseInt(tmpOptions.concurrency, 10) : 4
		});

	let tmpHandle;
	try { tmpHandle = tmpEngine.run(tmpPlan, { AutoConfirm: !!tmpOptions.yes }); }
	catch (pError) { console.error(pError.message); process.exitCode = 1; return; }

	console.log(`Running ${tmpPlan.Label || tmpPlan.Type} — ${tmpPlan.Steps.length} step(s)…`);
	let tmpRun = await tmpHandle.Done;
	let tmpSummary = tmpEngine.manifest.summary(tmpRun);
	console.log(`\n${tmpRun.Status}: ${tmpSummary.Complete}/${tmpSummary.StepCount} complete, ${tmpSummary.Errors} error(s). (run ${tmpRun.RunHash})`);
	if (tmpRun.Status !== 'Complete') { process.exitCode = 1; }
}

async function plan(pContext)
{
	let tmpArgs = pContext.Arguments || [];
	let tmpType = tmpArgs[0];
	if (!tmpType) { console.error('Usage: mm bulk plan <type> [targets…]'); process.exitCode = 1; return; }
	return planFor(pContext, tmpType, tmpArgs.slice(1));
}

async function run(pContext)
{
	let tmpArgs = pContext.Arguments || [];
	let tmpType = tmpArgs[0];
	if (!tmpType) { console.error('Usage: mm bulk run <type> [targets…] [--yes]'); process.exitCode = 1; return; }
	return runFor(pContext, tmpType, tmpArgs.slice(1));
}

async function runs(pContext)
{
	let tmpLoader = libSupport.loaderFromContext(pContext);
	let tmpManifest = new libManifest({ LogDir: tmpLoader.getRepoRoot() });
	let tmpRuns = tmpManifest.list();
	if (tmpRuns.length === 0) { console.log('No bulk-operation runs yet.'); return; }
	console.log('RUN                                       TYPE     STATUS     STEPS   WHEN');
	tmpRuns.slice(0, 30).forEach((pRun) =>
		{
			console.log(`${(pRun.RunHash + '                                        ').slice(0, 40)}  ${(pRun.Type + '        ').slice(0, 8)} ${(pRun.Status + '          ').slice(0, 10)} ${pRun.Complete}/${pRun.StepCount}     ${pRun.StartedAt}`);
		});
}

async function show(pContext)
{
	let tmpArgs = pContext.Arguments || [];
	let tmpId = tmpArgs[0];
	if (!tmpId) { console.error('Usage: mm bulk show <run-id>'); process.exitCode = 1; return; }
	let tmpLoader = libSupport.loaderFromContext(pContext);
	let tmpManifest = new libManifest({ LogDir: tmpLoader.getRepoRoot() });
	let tmpRun = tmpManifest.get(tmpId);
	if (!tmpRun) { console.error('Unknown run: ' + tmpId); process.exitCode = 1; return; }
	console.log(`${tmpRun.RunHash}  [${tmpRun.Type}]  ${tmpRun.Status}`);
	tmpRun.Steps.forEach((pStep) =>
		{
			console.log(`  ${pStep.Order + 1}. ${pStep.Target} — ${pStep.Status}`);
			pStep.Actions.forEach((pAction) => console.log(`       ${pAction.Op}: ${pAction.Status}${pAction.Error ? ' (' + pAction.Error + ')' : ''}`));
		});
}

async function dispatch(pContext)
{
	let tmpArgs = pContext.Arguments || [];
	let tmpVerb = tmpArgs[0];
	let tmpSub = Object.assign({}, pContext, { Arguments: tmpArgs.slice(1) });
	if (tmpVerb === 'plan') { return plan(tmpSub); }
	if (tmpVerb === 'run') { return run(tmpSub); }
	if (tmpVerb === 'runs') { return runs(pContext); }
	if (tmpVerb === 'show') { return show(tmpSub); }
	console.error('Usage: mm bulk <plan|run|runs|show>');
	process.exitCode = 1;
}

module.exports = { dispatch, plan, run, runs, show, planFor, runFor };
