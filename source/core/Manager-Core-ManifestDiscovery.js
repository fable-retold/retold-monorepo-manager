/**
 * Manager-Core-ManifestDiscovery
 *
 * Scans the disk for modules under a group, driven by that group's `Discover` glob(s) and
 * `ModuleMarker`. Deliberately NOT run at manifest read time — only by `manifest audit` /
 * `manifest backfill`, preserving the declare-authoritative model. Supports the common monorepo
 * shapes without a glob dependency: literal segments, `*` (one directory level), `**` (recursive).
 */
const libFS = require('fs');
const libPath = require('path');

// Directories never treated as modules or descended into.
const SKIP_DIRECTORY_NAMES = new Set(
	[ 'node_modules', '.git', 'dist', 'build', 'coverage', '.nyc_output', '.cache', '.vscode', '.idea', 'tmp' ]);

function isDirectory(pPath)
{
	try { return libFS.statSync(pPath).isDirectory(); }
	catch (pError) { return false; }
}

function fileExists(pPath)
{
	try { return libFS.statSync(pPath).isFile(); }
	catch (pError) { return false; }
}

function listSubdirectories(pDirectory)
{
	let tmpResults = [];
	let tmpEntries;
	try { tmpEntries = libFS.readdirSync(pDirectory, { withFileTypes: true }); }
	catch (pError) { return tmpResults; }

	for (let i = 0; i < tmpEntries.length; i++)
	{
		let tmpEntry = tmpEntries[i];
		if (!tmpEntry.isDirectory()) { continue; }
		if (tmpEntry.name.charAt(0) === '.') { continue; }
		if (SKIP_DIRECTORY_NAMES.has(tmpEntry.name)) { continue; }
		tmpResults.push(libPath.join(pDirectory, tmpEntry.name));
	}
	return tmpResults;
}

function walkAllDirectories(pDirectory)
{
	let tmpAll = [];
	let tmpStack = [ pDirectory ];
	while (tmpStack.length > 0)
	{
		let tmpDirectory = tmpStack.pop();
		tmpAll.push(tmpDirectory);
		let tmpSubdirectories = listSubdirectories(tmpDirectory);
		for (let i = 0; i < tmpSubdirectories.length; i++)
		{
			tmpStack.push(tmpSubdirectories[i]);
		}
	}
	return tmpAll;
}

/**
 * Expand a single glob pattern (relative to a base directory) to a list of matching directories.
 */
function expandPattern(pBaseDirectory, pPattern)
{
	let tmpSegments = String(pPattern || '').split('/').filter((pSegment) => (pSegment.length > 0));
	let tmpCurrent = [ pBaseDirectory ];

	for (let i = 0; i < tmpSegments.length; i++)
	{
		let tmpSegment = tmpSegments[i];
		let tmpNext = [];
		for (let j = 0; j < tmpCurrent.length; j++)
		{
			let tmpDirectory = tmpCurrent[j];
			if (tmpSegment === '*')
			{
				tmpNext = tmpNext.concat(listSubdirectories(tmpDirectory));
			}
			else if (tmpSegment === '**')
			{
				tmpNext = tmpNext.concat(walkAllDirectories(tmpDirectory));
			}
			else
			{
				let tmpCandidate = libPath.join(tmpDirectory, tmpSegment);
				if (isDirectory(tmpCandidate)) { tmpNext.push(tmpCandidate); }
			}
		}
		tmpCurrent = tmpNext;
	}
	return tmpCurrent;
}

class ManifestDiscovery
{
	/**
	 * Discover the module directories that exist on disk for a group.
	 *
	 * @param {object} pLoader - A loaded ManifestLoader.
	 * @param {object} pGroup - A group entry from the manifest.
	 * @returns {Array<{Name, AbsolutePath, RelativePath, MarkerPath}>}
	 */
	static discoverGroupModules(pLoader, pGroup)
	{
		pLoader.ensureLoaded();

		let tmpGroupFolder = pLoader.getGroupFolder(pGroup);
		let tmpPatterns = (Array.isArray(pGroup.Discover) && pGroup.Discover.length > 0) ? pGroup.Discover : [ '*' ];
		let tmpMarker = pGroup.ModuleMarker || 'package.json';

		let tmpSeen = new Set();
		let tmpModules = [];

		for (let i = 0; i < tmpPatterns.length; i++)
		{
			let tmpDirectories = expandPattern(tmpGroupFolder, tmpPatterns[i]);
			for (let j = 0; j < tmpDirectories.length; j++)
			{
				let tmpDirectory = tmpDirectories[j];
				if (tmpSeen.has(tmpDirectory)) { continue; }

				let tmpMarkerPath = libPath.join(tmpDirectory, tmpMarker);
				if (!fileExists(tmpMarkerPath)) { continue; }

				tmpSeen.add(tmpDirectory);
				tmpModules.push(
					{
						Name: libPath.basename(tmpDirectory),
						AbsolutePath: tmpDirectory,
						RelativePath: libPath.relative(pLoader.getRepoRoot(), tmpDirectory),
						MarkerPath: tmpMarkerPath
					});
			}
		}
		return tmpModules;
	}
}

module.exports = ManifestDiscovery;
module.exports.expandPattern = expandPattern;
