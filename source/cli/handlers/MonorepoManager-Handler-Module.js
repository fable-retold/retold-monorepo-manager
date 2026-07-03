/**
 * Handlers for module-scoped commands:
 *   mm run <module> <install|test|types|build|script>
 *   mm git <module> <pull|push|fetch|diff|log|add|commit>
 *   mm version <module> <patch|minor|major|X.Y.Z>
 *   mm deps <module> ncu [--apply] [--scope ecosystem|all]   |   mm deps sync [--write]
 */
const libSupport = require('./MonorepoManager-Handler-Support.js');
const libCommitComposer = require('../../core/Manager-Core-CommitComposer.js');
const libDepAligner = require('../../core/Manager-Core-DepAligner.js');

async function run(pContext)
{
	let tmpArguments = pContext.Arguments || [];
	let tmpName = tmpArguments[0];
	let tmpScript = tmpArguments[1];
	if (!tmpName || !tmpScript)
	{
		console.error('Usage: mm run <module> <install|test|types|build|script>');
		process.exitCode = 1;
		return;
	}

	let tmpLoader = libSupport.loaderFromContext(pContext);
	let tmpModule = libSupport.resolveModule(tmpLoader, tmpName);
	let tmpRunner = libSupport.newProcessRunner();

	let tmpCommand = 'npm';
	let tmpArgs;
	if (tmpScript === 'install') { tmpArgs = [ 'install' ]; }
	else if (tmpScript === 'test') { tmpArgs = [ 'test' ]; }
	else { tmpArgs = [ 'run', tmpScript ]; }

	let tmpCode = await libSupport.streamOperation(tmpRunner, () => tmpRunner.run(
		{ Command: tmpCommand, Args: tmpArgs, Cwd: tmpModule.AbsolutePath, Label: `${tmpScript} ${tmpName}` }));
	if (tmpCode !== 0) { process.exitCode = tmpCode; }
}

async function git(pContext)
{
	let tmpArguments = pContext.Arguments || [];
	let tmpName = tmpArguments[0];
	let tmpAction = tmpArguments[1];
	if (!tmpName || !tmpAction)
	{
		console.error('Usage: mm git <module> <pull|push|fetch|diff|log|add|commit>');
		process.exitCode = 1;
		return;
	}

	let tmpLoader = libSupport.loaderFromContext(pContext);
	let tmpModule = libSupport.resolveModule(tmpLoader, tmpName);
	let tmpConfig = tmpLoader.getConfig();
	let tmpCwd = tmpModule.AbsolutePath;
	let tmpOptions = pContext.Options || {};
	let tmpRunner = libSupport.newProcessRunner();

	async function stream(pArgs, pLabel)
	{
		let tmpCode = await libSupport.streamOperation(tmpRunner, () => tmpRunner.run(
			{ Command: 'git', Args: pArgs, Cwd: tmpCwd, Label: pLabel }));
		if (tmpCode !== 0) { process.exitCode = tmpCode; }
	}

	switch (tmpAction)
	{
		case 'pull':
			return stream([ 'pull', '--rebase', tmpConfig.GitRemote ], `pull ${tmpName}`);
		case 'push':
			return stream([ 'push' ], `push ${tmpName}`);
		case 'fetch':
			return stream([ 'fetch', tmpConfig.GitRemote ], `fetch ${tmpName}`);
		case 'log':
		{
			let tmpLimit = tmpOptions.limit ? parseInt(tmpOptions.limit, 10) : 20;
			return stream([ 'log', '--oneline', '-n', String(tmpLimit) ], `log ${tmpName}`);
		}
		case 'diff':
		{
			let tmpIntrospector = libSupport.introspectorFromContext(tmpLoader);
			let tmpDiff = tmpIntrospector.getGitDiff(tmpName, { Staged: !!tmpOptions.staged, Stat: !!tmpOptions.stat });
			process.stdout.write(tmpDiff + (tmpDiff.endsWith('\n') ? '' : '\n'));
			return;
		}
		case 'add':
		{
			let tmpPaths = tmpArguments.slice(2);
			let tmpAddArgs = [ 'add' ];
			if (tmpOptions.all || tmpPaths.length === 0) { tmpAddArgs.push('-A'); }
			else { tmpAddArgs = tmpAddArgs.concat(tmpPaths); }
			return stream(tmpAddArgs, `add ${tmpName}`);
		}
		case 'commit':
		{
			let tmpMessage = tmpOptions.message;
			if (!tmpMessage)
			{
				console.error('git commit requires a message: mm git <module> commit --message "<msg>"');
				process.exitCode = 1;
				return;
			}
			let tmpValidation = libCommitComposer.validateMessage(tmpMessage);
			if (!tmpValidation.Ok)
			{
				console.error(`Invalid commit message: ${tmpValidation.Problems.join('; ')}`);
				process.exitCode = 1;
				return;
			}
			let tmpBuilt = libCommitComposer.buildCommitArgs(tmpMessage, { AddAll: true });
			return stream(tmpBuilt.Args, `commit ${tmpName}`);
		}
		default:
			console.error(`Unknown git action: ${tmpAction}. Expected pull|push|fetch|diff|log|add|commit.`);
			process.exitCode = 1;
	}
}

async function version(pContext)
{
	let tmpArguments = pContext.Arguments || [];
	let tmpName = tmpArguments[0];
	let tmpBump = tmpArguments[1];
	if (!tmpName || !tmpBump)
	{
		console.error('Usage: mm version <module> <patch|minor|major|X.Y.Z>');
		process.exitCode = 1;
		return;
	}

	let tmpLoader = libSupport.loaderFromContext(pContext);
	let tmpModule = libSupport.resolveModule(tmpLoader, tmpName);
	let tmpRunner = libSupport.newProcessRunner();

	let tmpCode = await libSupport.streamOperation(tmpRunner, () => tmpRunner.run(
		{ Command: 'npm', Args: [ 'version', tmpBump, '--no-git-tag-version' ], Cwd: tmpModule.AbsolutePath, Label: `version ${tmpName}` }));
	if (tmpCode !== 0) { process.exitCode = tmpCode; }
}

async function deps(pContext)
{
	let tmpArguments = pContext.Arguments || [];
	let tmpOptions = pContext.Options || {};
	let tmpLoader = libSupport.loaderFromContext(pContext);

	// Repo-wide dependency alignment: `mm deps sync [--write]`
	if (tmpArguments[0] === 'sync')
	{
		let tmpResult = libDepAligner.align(tmpLoader, { Write: !!tmpOptions.write });
		if (tmpResult.Changes.length === 0)
		{
			console.log(`All ecosystem dependency ranges already aligned (source: ${tmpResult.VersionSource}).`);
			return;
		}
		console.log(`${tmpResult.Changes.length} dependency range(s) ${tmpResult.Written ? 'aligned' : 'would be aligned'} (source: ${tmpResult.VersionSource}):`);
		tmpResult.Changes.forEach((pChange) => console.log(`  ${pChange.Module}: ${pChange.Dependency}  ${pChange.From} → ${pChange.To}`));
		if (!tmpResult.Written) { console.log('\nDry run. Re-run with --write to apply.'); }
		return;
	}

	// Per-module dependency-update check: `mm deps <module> ncu [--apply] [--scope ecosystem|all]`
	let tmpName = tmpArguments[0];
	let tmpAction = tmpArguments[1] || 'ncu';
	if (!tmpName || tmpAction !== 'ncu')
	{
		console.error('Usage: mm deps <module> ncu [--apply] [--scope ecosystem|all]  |  mm deps sync [--write]');
		process.exitCode = 1;
		return;
	}

	let tmpModule = libSupport.resolveModule(tmpLoader, tmpName);
	let tmpApply = !!tmpOptions.apply;
	let tmpScope = tmpOptions.scope || 'all';
	let tmpRunner = libSupport.newProcessRunner();

	let tmpNcuArgs = [ 'npm-check-updates' ];
	if (tmpApply) { tmpNcuArgs.push('-u'); }
	if (tmpScope === 'ecosystem')
	{
		let tmpNames = tmpLoader.getAllModuleNames();
		if (tmpNames.length > 0) { tmpNcuArgs.push('--filter', tmpNames.join(',')); }
	}

	let tmpCode;
	if (tmpApply)
	{
		tmpCode = await libSupport.streamOperation(tmpRunner, () => tmpRunner.runSequence(
			{
				Cwd: tmpModule.AbsolutePath,
				AbortOnError: true,
				Steps:
				[
					{ Command: 'npx', Args: tmpNcuArgs, Label: `ncu -u ${tmpName}` },
					{ Command: 'npm', Args: [ 'install' ], Label: `install ${tmpName}` }
				]
			}));
	}
	else
	{
		tmpCode = await libSupport.streamOperation(tmpRunner, () => tmpRunner.run(
			{ Command: 'npx', Args: tmpNcuArgs, Cwd: tmpModule.AbsolutePath, Label: `ncu ${tmpName}` }));
	}
	if (tmpCode !== 0) { process.exitCode = tmpCode; }
}

module.exports = { run, git, version, deps };
