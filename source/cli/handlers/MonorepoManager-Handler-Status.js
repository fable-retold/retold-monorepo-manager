/**
 * Handlers: `mm status [published]` and `mm show <module>`.
 */
const libSupport = require('./MonorepoManager-Handler-Support.js');
const libDepAligner = require('../../core/Manager-Core-DepAligner.js');

function pad(pValue, pWidth)
{
	let tmpString = String((pValue === null || pValue === undefined) ? '' : pValue);
	return (tmpString.length >= pWidth) ? tmpString : tmpString + ' '.repeat(pWidth - tmpString.length);
}

function aheadBehind(pRow)
{
	let tmpAhead = pRow.Ahead || 0;
	let tmpBehind = pRow.Behind || 0;
	if (tmpAhead === 0 && tmpBehind === 0) { return '·'; }
	return `${tmpAhead > 0 ? '↑' + tmpAhead : ''}${tmpBehind > 0 ? '↓' + tmpBehind : ''}`;
}

function versionState(pLocal, pPublished)
{
	if (!pPublished) { return 'unpublished'; }
	if (!pLocal) { return '?'; }
	let tmpCompare = libDepAligner.compareSemver(pLocal, pPublished);
	if (tmpCompare === 0) { return 'even'; }
	return (tmpCompare > 0) ? 'ahead' : 'behind';
}

async function status(pContext)
{
	let tmpLoader = libSupport.loaderFromContext(pContext);
	let tmpIntrospector = libSupport.introspectorFromContext(tmpLoader);

	let tmpArguments = pContext.Arguments || [];
	let tmpPublished = (tmpArguments[0] === 'published');
	let tmpDirtyOnly = !!(pContext.Options && pContext.Options.dirtyOnly);

	let tmpResults = await tmpIntrospector.scanAllModulesAsync({});
	let tmpNames = Object.keys(tmpResults).sort();

	let tmpPublishedVersions = {};
	if (tmpPublished)
	{
		let tmpPackageNames = tmpNames
			.map((pName) => (tmpResults[pName] && tmpResults[pName].PackageName))
			.filter(Boolean);
		tmpPublishedVersions = await tmpIntrospector.fetchPublishedVersionsParallel(tmpPackageNames, {});
	}

	let tmpShown = 0;
	let tmpDirtyCount = 0;
	let tmpLines = [];
	for (let i = 0; i < tmpNames.length; i++)
	{
		let tmpName = tmpNames[i];
		let tmpRow = tmpResults[tmpName];
		if (tmpRow.Error)
		{
			tmpLines.push(`${pad(tmpName, 34)} ${pad('ERROR', 8)} ${tmpRow.Error}`);
			continue;
		}
		if (tmpRow.Dirty) { tmpDirtyCount++; }
		if (tmpDirtyOnly && tmpRow.NextAction === 'in-sync' && !tmpRow.Dirty) { continue; }
		tmpShown++;

		let tmpVersionColumn = tmpRow.LocalVersion || '';
		if (tmpPublished)
		{
			let tmpPub = tmpPublishedVersions[tmpRow.PackageName] || null;
			tmpVersionColumn = `${tmpRow.LocalVersion || '?'} / ${tmpPub || '—'} (${versionState(tmpRow.LocalVersion, tmpPub)})`;
		}

		tmpLines.push(
			`${pad(tmpName, 34)} ${pad(tmpRow.Branch || '?', 10)} ${pad(aheadBehind(tmpRow), 8)} ${pad(tmpRow.Dirty ? 'dirty' : 'clean', 6)} ${pad(tmpRow.NextAction || '', 9)} ${tmpVersionColumn}`);
	}

	console.log(`Manifest: ${tmpLoader.getManifestPath()}`);
	console.log('');
	console.log(`${pad('MODULE', 34)} ${pad('BRANCH', 10)} ${pad('±ORIGIN', 8)} ${pad('STATE', 6)} ${pad('NEXT', 9)} VERSION${tmpPublished ? ' (local / npm)' : ''}`);
	tmpLines.forEach((pLine) => console.log(pLine));
	console.log('');
	console.log(`${tmpShown} shown${tmpDirtyOnly ? ' (dirty/action-needed only)' : ''}, ${tmpDirtyCount} dirty, ${tmpNames.length} total.`);
}

async function show(pContext)
{
	let tmpArguments = pContext.Arguments || [];
	let tmpName = tmpArguments[0];
	if (!tmpName)
	{
		console.error('Usage: mm show <module>');
		process.exitCode = 1;
		return;
	}

	let tmpLoader = libSupport.loaderFromContext(pContext);
	let tmpModule = tmpLoader.getModule(tmpName);
	if (!tmpModule)
	{
		console.error(`Unknown module: ${tmpName} (not in the manifest).`);
		process.exitCode = 1;
		return;
	}

	let tmpIntrospector = libSupport.introspectorFromContext(tmpLoader);
	let tmpPackage = tmpIntrospector.readPackageJson(tmpName);
	let tmpGit = tmpIntrospector.getGitStatus(tmpName);

	console.log(tmpName);
	console.log(`  Group:   ${tmpModule.GroupName}`);
	console.log(`  Path:    ${tmpModule.AbsolutePath}`);
	console.log(`  Type:    ${tmpModule.Type || '(none)'}`);
	if (tmpPackage)
	{
		console.log(`  Package: ${tmpPackage.name || '?'}@${tmpPackage.version || '?'}`);
	}
	if (tmpGit)
	{
		console.log(`  Git:     branch ${tmpGit.Branch || '?'}  ${aheadBehind(tmpGit)}  ${tmpGit.Dirty ? 'DIRTY' : 'clean'}  → ${tmpGit.NextAction}`);
		if (tmpGit.OriginUrl) { console.log(`  Origin:  ${tmpGit.OriginUrl}`); }
	}
	else
	{
		console.log('  Git:     (not a git working copy)');
	}

	let tmpEcosystemDeps = [];
	try { tmpEcosystemDeps = tmpIntrospector.getEcosystemDepsSync(tmpName, {}) || []; }
	catch (pError) { /* npm view may be offline; skip */ }

	if (tmpEcosystemDeps.length > 0)
	{
		console.log('  Ecosystem deps:');
		tmpEcosystemDeps.forEach((pDep) =>
		{
			let tmpStale = (pDep.CoversLatest === false) ? `  (stale; latest ${pDep.LatestOnNpm || '?'})` : '';
			console.log(`    ${pad(pDep.Name, 30)} ${pDep.Range || ''}${tmpStale}`);
		});
	}
}

module.exports = { status, show };
