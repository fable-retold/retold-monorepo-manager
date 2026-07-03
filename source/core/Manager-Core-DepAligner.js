/**
 * Manager-Core-DepAligner
 *
 * The generic, reusable half of retold-manager's `sync-deps` — with the quackage/docs coupling and
 * the dual-remote fork push removed. Aligns every module's in-ecosystem dependency ranges to a
 * declared VersionSource, leaving the changes uncommitted for human review (no install, no commit,
 * no push). `file:`/`link:` workspace links are never touched.
 *
 * VersionSource (from the manifest, default 'highest-in-repo'):
 *   - 'highest-in-repo'    : each ecosystem package's own highest version found across the repo.
 *   - 'root-package'       : versions declared in the repo-root package.json's dependencies.
 *   - 'versions-map:<path>': a JSON file of { "<name>": "<version>" }.
 */
const libFS = require('fs');
const libPath = require('path');

/**
 * Compare two clean x.y.z semver strings. Returns 1 if pA > pB, -1 if pA < pB, 0 if equal.
 */
function compareSemver(pA, pB)
{
	let tmpA = String(pA).replace(/^[\^~]/, '').split('-')[0].split('.').map((pPart) => (parseInt(pPart, 10) || 0));
	let tmpB = String(pB).replace(/^[\^~]/, '').split('-')[0].split('.').map((pPart) => (parseInt(pPart, 10) || 0));
	for (let i = 0; i < 3; i++)
	{
		let tmpLeft = tmpA[i] || 0;
		let tmpRight = tmpB[i] || 0;
		if (tmpLeft > tmpRight) { return 1; }
		if (tmpLeft < tmpRight) { return -1; }
	}
	return 0;
}

/**
 * Detect a package.json's indentation style so we can rewrite it in place without reformatting.
 */
function detectIndent(pText)
{
	let tmpMatch = pText.match(/\n([\t ]+)"/);
	if (tmpMatch)
	{
		return tmpMatch[1];
	}
	return '\t';
}

function readJsonSafe(pPath)
{
	try { return JSON.parse(libFS.readFileSync(pPath, 'utf8')); }
	catch (pError) { return null; }
}

class DepAligner
{
	/**
	 * Build the { name -> version } source-of-truth map for a repo.
	 * @param {object} pLoader - A ManifestLoader.
	 * @param {string} pVersionSource - The VersionSource directive.
	 * @returns {Map<string,string>}
	 */
	static buildVersionMap(pLoader, pVersionSource)
	{
		pLoader.ensureLoaded();
		let tmpMode = pVersionSource || 'highest-in-repo';
		let tmpMap = new Map();

		if (tmpMode.indexOf('versions-map:') === 0)
		{
			let tmpFilePath = libPath.resolve(pLoader.getRepoRoot(), tmpMode.slice('versions-map:'.length));
			let tmpVersions = readJsonSafe(tmpFilePath) || {};
			Object.keys(tmpVersions).forEach((pName) => tmpMap.set(pName, String(tmpVersions[pName]).replace(/^[\^~]/, '')));
			return tmpMap;
		}

		if (tmpMode === 'root-package')
		{
			let tmpRootPackage = readJsonSafe(libPath.join(pLoader.getRepoRoot(), 'package.json')) || {};
			let tmpSections = [ tmpRootPackage.dependencies, tmpRootPackage.devDependencies ];
			for (let i = 0; i < tmpSections.length; i++)
			{
				let tmpSection = tmpSections[i];
				if (!tmpSection) { continue; }
				Object.keys(tmpSection).forEach((pName) => tmpMap.set(pName, String(tmpSection[pName]).replace(/^[\^~]/, '')));
			}
			return tmpMap;
		}

		// Default: highest-in-repo — each module's own package.json version.
		let tmpModules = pLoader.getAllModules();
		for (let i = 0; i < tmpModules.length; i++)
		{
			let tmpPackage = readJsonSafe(libPath.join(tmpModules[i].AbsolutePath, 'package.json'));
			if (!tmpPackage || !tmpPackage.name || !tmpPackage.version) { continue; }
			let tmpExisting = tmpMap.get(tmpPackage.name);
			if (!tmpExisting || compareSemver(tmpPackage.version, tmpExisting) > 0)
			{
				tmpMap.set(tmpPackage.name, tmpPackage.version);
			}
		}
		return tmpMap;
	}

	/**
	 * Align every module's in-ecosystem dep ranges to the version map.
	 * @param {object} pLoader - A ManifestLoader.
	 * @param {object} [pOptions] - { Write:boolean, VersionSource?:string }
	 * @returns {{ Changes, Written, VersionSource }}
	 */
	static align(pLoader, pOptions)
	{
		let tmpOptions = pOptions || {};
		pLoader.ensureLoaded();

		let tmpConfig = pLoader.getConfig();
		let tmpVersionSource = tmpOptions.VersionSource || tmpConfig.VersionSource || 'highest-in-repo';
		let tmpVersionMap = DepAligner.buildVersionMap(pLoader, tmpVersionSource);

		let tmpChanges = [];
		let tmpModules = pLoader.getAllModules();

		for (let i = 0; i < tmpModules.length; i++)
		{
			let tmpModule = tmpModules[i];
			let tmpPackagePath = libPath.join(tmpModule.AbsolutePath, 'package.json');
			let tmpText;
			try { tmpText = libFS.readFileSync(tmpPackagePath, 'utf8'); }
			catch (pError) { continue; }

			let tmpPackage;
			try { tmpPackage = JSON.parse(tmpText); }
			catch (pError) { continue; }

			let tmpModified = false;
			let tmpSections = [ 'dependencies', 'devDependencies' ];
			for (let s = 0; s < tmpSections.length; s++)
			{
				let tmpDependencies = tmpPackage[tmpSections[s]];
				if (!tmpDependencies) { continue; }

				let tmpNames = Object.keys(tmpDependencies);
				for (let n = 0; n < tmpNames.length; n++)
				{
					let tmpName = tmpNames[n];
					if (!pLoader.isEcosystemDependency(tmpName)) { continue; }

					let tmpTargetVersion = tmpVersionMap.get(tmpName);
					if (!tmpTargetVersion) { continue; }

					let tmpCurrent = tmpDependencies[tmpName];
					if (typeof tmpCurrent !== 'string') { continue; }
					if (tmpCurrent.indexOf('file:') === 0 || tmpCurrent.indexOf('link:') === 0) { continue; }

					let tmpDesired = `^${tmpTargetVersion}`;
					if (tmpCurrent !== tmpDesired)
					{
						tmpChanges.push({ Module: tmpModule.Name, Section: tmpSections[s], Dependency: tmpName, From: tmpCurrent, To: tmpDesired });
						tmpDependencies[tmpName] = tmpDesired;
						tmpModified = true;
					}
				}
			}

			if (tmpModified && tmpOptions.Write)
			{
				let tmpIndent = detectIndent(tmpText);
				let tmpOutput = JSON.stringify(tmpPackage, null, tmpIndent) + '\n';
				let tmpTemporaryPath = `${tmpPackagePath}.tmp-${process.pid}`;
				libFS.writeFileSync(tmpTemporaryPath, tmpOutput, 'utf8');
				libFS.renameSync(tmpTemporaryPath, tmpPackagePath);
			}
		}

		return { Changes: tmpChanges, Written: !!tmpOptions.Write, VersionSource: tmpVersionSource };
	}
}

module.exports = DepAligner;
module.exports.compareSemver = compareSemver;
