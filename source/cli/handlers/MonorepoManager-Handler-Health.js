/**
 * Handler: health
 *
 * Prints the tool version and a summary of the discovered Modules-Manifest.json.
 * Doubles as a smoke test of the config core: it exercises manifest auto-discovery
 * (walking up from cwd) and the generic schema shape, with no web server required.
 */
const libManifestLocator = require('../../core/Manager-Core-ManifestLocator.js');

module.exports = async function handleHealth(pContext)
{
	let tmpOptions = pContext.Options || {};
	let tmpPackage = pContext.Package || {};

	console.log(`${tmpPackage.name || 'retold-monorepo-manager'} v${tmpPackage.version || '0.0.0'}`);
	if (tmpPackage.description)
	{
		console.log(tmpPackage.description);
	}

	let tmpManifestOption = tmpOptions.manifest || false;
	let tmpLoaded = libManifestLocator.load(tmpManifestOption || process.cwd());

	if (!tmpLoaded)
	{
		console.log('');
		console.log('Manifest:   (none found — searched upward from cwd)');
		console.log('');
		console.log('Point at one explicitly with:  mm health --manifest <path>');
		console.log('Or generate one with:          mm manifest backfill --write   (Phase 1)');
		return;
	}

	let tmpManifest = tmpLoaded.Manifest || {};
	let tmpGroups = Array.isArray(tmpManifest.Groups) ? tmpManifest.Groups : [];
	let tmpModuleCount = tmpGroups.reduce((pSum, pGroup) => (pSum + (Array.isArray(pGroup.Modules) ? pGroup.Modules.length : 0)), 0);

	console.log('');
	console.log(`Manifest:   ${tmpLoaded.Path}`);
	console.log(`Name:       ${tmpManifest.Name || '(unnamed)'}`);
	console.log(`Schema:     ${tmpManifest.SchemaVersion || '(none)'}`);
	console.log(`Groups:     ${tmpGroups.length}`);
	console.log(`Modules:    ${tmpModuleCount}`);
	console.log('');
	console.log('OK');
};
