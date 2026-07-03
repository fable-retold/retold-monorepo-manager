/**
 * Manager-Core-ManifestTools
 *
 * The generic manifest hygiene pair, ported from retold-manager's bin scripts with the
 * fork-specific machinery (shell-array third source, forkable/owner, dual-remote push) removed:
 *
 *   - audit(loader)              -> manifest-vs-disk drift report (exit-coded by the CLI handler)
 *   - backfill(loader, options)  -> synthesize entries for on-disk modules missing from the manifest
 *
 * Retained ergonomics from retold: dry-run by default, atomic tmp+rename write, never auto-remove
 * orphans (a human decision), stable sort for clean diffs.
 */
const libFS = require('fs');
const libPath = require('path');

const libDiscovery = require('./Manager-Core-ManifestDiscovery.js');

function fileExists(pPath)
{
	try { return libFS.statSync(pPath).isFile(); }
	catch (pError) { return false; }
}

class ManifestTools
{
	/**
	 * Compare the manifest against what is on disk.
	 * @param {object} pLoader - A ManifestLoader.
	 * @returns {{ ManifestPath, Groups, OnlyInManifest, OnlyInDisk, HasDrift }}
	 */
	static audit(pLoader)
	{
		pLoader.ensureLoaded();

		let tmpReport =
		{
			ManifestPath: pLoader.getManifestPath(),
			Groups: [],
			OnlyInManifest: [],
			OnlyInDisk: [],
			HasDrift: false
		};

		let tmpGroups = pLoader.getGroups();
		for (let i = 0; i < tmpGroups.length; i++)
		{
			let tmpGroup = tmpGroups[i];
			let tmpMarker = tmpGroup.ModuleMarker || 'package.json';

			let tmpDeclaredModules = (Array.isArray(tmpGroup.Modules) ? tmpGroup.Modules : [])
				.map((pModule) =>
				{
					let tmpEntry = pLoader.getModule(pModule.Name);
					return { Name: pModule.Name, AbsolutePath: tmpEntry ? tmpEntry.AbsolutePath : null };
				})
				.filter((pModule) => (pModule.AbsolutePath !== null));

			let tmpDeclaredAbsolute = new Set(tmpDeclaredModules.map((pModule) => (pModule.AbsolutePath)));

			let tmpDiscovered = libDiscovery.discoverGroupModules(pLoader, tmpGroup);

			let tmpOnlyInDisk = tmpDiscovered.filter((pModule) => (!tmpDeclaredAbsolute.has(pModule.AbsolutePath)));
			let tmpOnlyInManifest = tmpDeclaredModules.filter((pModule) => (!fileExists(libPath.join(pModule.AbsolutePath, tmpMarker))));

			tmpReport.Groups.push(
				{
					Name: tmpGroup.Name,
					OnlyInManifest: tmpOnlyInManifest.map((pModule) => (pModule.Name)),
					OnlyInDisk: tmpOnlyInDisk.map((pModule) => (pModule.Name))
				});

			for (let j = 0; j < tmpOnlyInManifest.length; j++)
			{
				tmpReport.OnlyInManifest.push({ Group: tmpGroup.Name, Name: tmpOnlyInManifest[j].Name, AbsolutePath: tmpOnlyInManifest[j].AbsolutePath });
			}
			for (let j = 0; j < tmpOnlyInDisk.length; j++)
			{
				tmpReport.OnlyInDisk.push({ Group: tmpGroup.Name, Name: tmpOnlyInDisk[j].Name, RelativePath: tmpOnlyInDisk[j].RelativePath });
			}
		}

		tmpReport.HasDrift = (tmpReport.OnlyInManifest.length > 0) || (tmpReport.OnlyInDisk.length > 0);
		return tmpReport;
	}

	/**
	 * Synthesize + (optionally) write manifest entries for on-disk modules missing from the manifest.
	 * @param {object} pLoader - A ManifestLoader.
	 * @param {object} [pOptions] - { Write:boolean }
	 * @returns {{ Added, Written, ManifestText }}
	 */
	static backfill(pLoader, pOptions)
	{
		let tmpOptions = pOptions || {};
		pLoader.ensureLoaded();

		let tmpConfig = pLoader.getConfig();
		let tmpRaw = pLoader.raw;
		let tmpAdded = [];

		let tmpGroups = Array.isArray(tmpRaw.Groups) ? tmpRaw.Groups : [];
		for (let i = 0; i < tmpGroups.length; i++)
		{
			let tmpGroup = tmpGroups[i];
			let tmpMarker = tmpGroup.ModuleMarker || 'package.json';

			let tmpDeclaredAbsolute = new Set(
				(Array.isArray(tmpGroup.Modules) ? tmpGroup.Modules : [])
					.map((pModule) => { let tmpEntry = pLoader.getModule(pModule.Name); return tmpEntry ? tmpEntry.AbsolutePath : null; })
					.filter(Boolean));

			let tmpDiscovered = libDiscovery.discoverGroupModules(pLoader, tmpGroup);
			let tmpNewModules = tmpDiscovered.filter((pModule) => (!tmpDeclaredAbsolute.has(pModule.AbsolutePath)));

			if (!Array.isArray(tmpGroup.Modules)) { tmpGroup.Modules = []; }

			for (let j = 0; j < tmpNewModules.length; j++)
			{
				let tmpEntry = ManifestTools.synthesizeEntry(tmpNewModules[j], tmpConfig, tmpMarker);
				tmpGroup.Modules.push(tmpEntry);
				tmpAdded.push({ Group: tmpGroup.Name, Name: tmpEntry.Name, Path: tmpEntry.Path });
			}

			// Stable sort for clean diffs.
			tmpGroup.Modules.sort((pA, pB) => (String(pA.Name).localeCompare(String(pB.Name))));
		}

		let tmpManifestText = JSON.stringify(tmpRaw, null, '\t') + '\n';
		let tmpWritten = false;
		if (tmpOptions.Write && tmpAdded.length > 0)
		{
			ManifestTools.atomicWrite(pLoader.getManifestPath(), tmpManifestText);
			tmpWritten = true;
		}

		return { Added: tmpAdded, Written: tmpWritten, ManifestText: tmpManifestText };
	}

	/**
	 * Build a manifest entry for a discovered module directory.
	 */
	static synthesizeEntry(pDiscovered, pConfig, pMarker)
	{
		let tmpDescription = '';
		if (pMarker === 'package.json')
		{
			try
			{
				let tmpPackage = JSON.parse(libFS.readFileSync(pDiscovered.MarkerPath, 'utf8'));
				tmpDescription = tmpPackage.description || '';
			}
			catch (pError) { /* leave description empty */ }
		}

		let tmpEntry =
		{
			Name: pDiscovered.Name,
			Path: pDiscovered.RelativePath,
			Type: 'library',
			Description: tmpDescription,
			GitHub: null,
			Documentation: null,
			RelatedModules: []
		};

		if (pConfig.Org && pConfig.GitTemplate)
		{
			tmpEntry.GitHub = pConfig.GitTemplate.split('{org}').join(pConfig.Org).split('{name}').join(pDiscovered.Name);
		}
		if (pConfig.Org && pConfig.DocsTemplate)
		{
			tmpEntry.Documentation = pConfig.DocsTemplate.split('{org}').join(pConfig.Org).split('{name}').join(pDiscovered.Name);
		}

		return tmpEntry;
	}

	static atomicWrite(pPath, pContent)
	{
		let tmpTemporaryPath = `${pPath}.tmp-${process.pid}`;
		libFS.writeFileSync(tmpTemporaryPath, pContent, 'utf8');
		libFS.renameSync(tmpTemporaryPath, pPath);
	}
}

module.exports = ManifestTools;
