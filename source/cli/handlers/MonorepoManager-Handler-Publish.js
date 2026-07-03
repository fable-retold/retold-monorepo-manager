/**
 * Handler: `mm publish <check|run> <module>`.
 *
 * `check` runs the read-only pre-publish validator. `run` re-validates fresh in-process, and only
 * with --yes shells `npm publish`. This is the honest CLI form of the web publish handshake: rather
 * than sharing a server-side PreviewHash session, the CLI recomputes the hash immediately before
 * publishing — the guardrail's intent ("validated right before publish") is preserved.
 */
const libSupport = require('./MonorepoManager-Handler-Support.js');
const libPrePublishValidator = require('../../core/Manager-Core-PrePublishValidator.js');

function printReport(pReport)
{
	console.log(`Module:      ${pReport.Package || pReport.Module}`);
	console.log(`Local:       ${pReport.LocalVersion || '?'}`);
	console.log(`Published:   ${pReport.PublishedVersion || '(unpublished)'}`);
	if (pReport.Problems && pReport.Problems.length > 0)
	{
		console.log('Problems:');
		pReport.Problems.forEach((pProblem) => console.log(`  [${pProblem.Severity || '?'}] ${pProblem.Code}: ${pProblem.Message}`));
	}
	console.log(`OkToPublish: ${pReport.OkToPublish}`);
}

async function publish(pContext)
{
	let tmpArguments = pContext.Arguments || [];
	let tmpSub = tmpArguments[0];
	let tmpName = tmpArguments[1];

	if ((tmpSub !== 'check' && tmpSub !== 'run') || !tmpName)
	{
		console.error('Usage: mm publish check <module>  |  mm publish run <module> --yes');
		process.exitCode = 1;
		return;
	}

	let tmpLoader = libSupport.loaderFromContext(pContext);
	let tmpModule = libSupport.resolveModule(tmpLoader, tmpName);
	let tmpIntrospector = libSupport.introspectorFromContext(tmpLoader);
	let tmpValidator = new libPrePublishValidator({ introspector: tmpIntrospector, ManifestLoader: tmpLoader });

	let tmpReport = await tmpValidator.validate(tmpName, {});
	printReport(tmpReport);

	if (tmpSub === 'check')
	{
		if (!tmpReport.OkToPublish) { process.exitCode = 1; }
		return;
	}

	// tmpSub === 'run'
	if (!tmpReport.OkToPublish)
	{
		console.error('\nRefusing to publish: pre-publish validation failed.');
		process.exitCode = 1;
		return;
	}

	if (!(pContext.Options && pContext.Options.yes))
	{
		console.error(`\nValidation OK. Re-run with --yes to actually run \`npm publish\`.  (PreviewHash: ${tmpReport.PreviewHash})`);
		return;
	}

	let tmpRunner = libSupport.newProcessRunner();
	let tmpCode = await libSupport.streamOperation(tmpRunner, () => tmpRunner.run(
		{ Command: 'npm', Args: [ 'publish' ], Cwd: tmpModule.AbsolutePath, Label: `publish ${tmpName}` }));
	if (tmpCode !== 0) { process.exitCode = tmpCode; }
}

module.exports = { publish };
