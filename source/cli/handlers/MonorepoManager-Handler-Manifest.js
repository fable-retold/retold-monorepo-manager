/**
 * Handlers: `mm manifest <verb>` — audit | backfill | reload | migrate.
 */
const libFS = require('fs');
const libPath = require('path');

const libSupport = require('./MonorepoManager-Handler-Support.js');
const libManifestTools = require('../../core/Manager-Core-ManifestTools.js');
const libManifestMigrate = require('../../core/Manager-Core-ManifestMigrate.js');

async function audit(pContext)
{
	let tmpLoader = libSupport.loaderFromContext(pContext);
	let tmpReport = libManifestTools.audit(tmpLoader);

	if (pContext.Options && pContext.Options.json)
	{
		console.log(JSON.stringify(tmpReport, null, 2));
		if (tmpReport.HasDrift) { process.exitCode = 1; }
		return;
	}

	console.log(`Manifest: ${tmpReport.ManifestPath}`);
	for (let i = 0; i < tmpReport.Groups.length; i++)
	{
		let tmpGroup = tmpReport.Groups[i];
		if (tmpGroup.OnlyInManifest.length === 0 && tmpGroup.OnlyInDisk.length === 0) { continue; }
		console.log('');
		console.log(`[${tmpGroup.Name}]`);
		tmpGroup.OnlyInManifest.forEach((pName) => console.log(`  - only in manifest (missing on disk): ${pName}`));
		tmpGroup.OnlyInDisk.forEach((pName) => console.log(`  + only on disk (missing from manifest): ${pName}`));
	}

	console.log('');
	if (tmpReport.HasDrift)
	{
		console.log(`DRIFT: ${tmpReport.OnlyInManifest.length} only-in-manifest, ${tmpReport.OnlyInDisk.length} only-on-disk. Run \`mm manifest backfill --write\` to add on-disk modules.`);
		process.exitCode = 1;
	}
	else
	{
		console.log('OK — manifest matches disk.');
	}
}

async function backfill(pContext)
{
	let tmpLoader = libSupport.loaderFromContext(pContext);
	let tmpWrite = !!(pContext.Options && pContext.Options.write);
	let tmpResult = libManifestTools.backfill(tmpLoader, { Write: tmpWrite });

	if (tmpResult.Added.length === 0)
	{
		console.log('No new modules found on disk. Manifest is up to date.');
		return;
	}

	console.log(`${tmpResult.Added.length} module(s) ${tmpWrite ? 'added to' : 'would be added to'} the manifest:`);
	tmpResult.Added.forEach((pAdded) => console.log(`  + [${pAdded.Group}] ${pAdded.Name}  (${pAdded.Path})`));
	console.log('');
	if (tmpWrite)
	{
		console.log(`Wrote ${tmpLoader.getManifestPath()}`);
	}
	else
	{
		console.log('Dry run. Re-run with --write to apply.');
	}
}

async function reload(pContext)
{
	// For the CLI, "reload" is a parse-and-validate: load fresh and report the summary.
	let tmpLoader = libSupport.loaderFromContext(pContext);
	let tmpGroups = tmpLoader.getGroups();
	let tmpModuleCount = tmpLoader.getAllModuleNames().length;
	console.log(`Loaded ${tmpLoader.getManifestPath()}`);
	console.log(`Groups: ${tmpGroups.length}   Modules: ${tmpModuleCount}   OK`);
}

async function migrate(pContext)
{
	let tmpOptions = pContext.Options || {};
	let tmpInput = tmpOptions.input;
	if (!tmpInput)
	{
		console.error('mm manifest migrate requires --input <path-to-v1-manifest>');
		process.exitCode = 1;
		return;
	}

	let tmpInputPath = libPath.resolve(tmpInput);
	let tmpV1Raw = JSON.parse(libFS.readFileSync(tmpInputPath, 'utf8'));
	let tmpResult = libManifestMigrate.migrate(tmpV1Raw, { DefaultBranch: tmpOptions.defaultBranch });
	let tmpManifestText = JSON.stringify(tmpResult.Manifest, null, '\t') + '\n';

	if (tmpOptions.write)
	{
		let tmpOutputPath = libPath.resolve(tmpOptions.output || 'Modules-Manifest.json');
		libFS.writeFileSync(tmpOutputPath, tmpManifestText, 'utf8');
		console.log(`Migrated ${tmpResult.Stats.Groups} groups / ${tmpResult.Stats.Modules} modules (dropped ${tmpResult.Stats.DroppedFields} fork field(s)).`);
		console.log(`Wrote ${tmpOutputPath}`);
	}
	else
	{
		// Emit the migrated manifest to stdout so it can be piped/reviewed; stats to stderr.
		process.stdout.write(tmpManifestText);
		console.error(`# Migrated ${tmpResult.Stats.Groups} groups / ${tmpResult.Stats.Modules} modules (dropped ${tmpResult.Stats.DroppedFields} fork field(s)). Re-run with --write [--output <path>] to save.`);
	}
}

async function dispatch(pContext)
{
	let tmpArguments = pContext.Arguments || [];
	let tmpVerb = tmpArguments[0];
	let tmpVerbs = { audit, backfill, reload, migrate };
	if (!tmpVerb || !tmpVerbs[tmpVerb])
	{
		console.error(`Usage: mm manifest <audit|backfill|reload|migrate>`);
		process.exitCode = 1;
		return;
	}
	// Shift the verb off so a verb handler sees only its own trailing args.
	let tmpVerbContext = Object.assign({}, pContext, { Arguments: tmpArguments.slice(1) });
	return tmpVerbs[tmpVerb](tmpVerbContext);
}

module.exports = { audit, backfill, reload, migrate, dispatch };
