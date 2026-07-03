/**
 * Manager-Core-ManifestLoader
 *
 * Reads a monorepo's Modules-Manifest.json and builds the indexes the rest of the tool uses:
 *   - `raw`            -- the parsed manifest object (as-shipped)
 *   - `groups`         -- array matching `raw.Groups`
 *   - `moduleByName`   -- Map<string, moduleEntry> augmented with GroupName / GroupDiskName / AbsolutePath
 *   - `groupByName`    -- Map<string, group>
 *   - `ecosystemNames` -- Set<string> of every module name declared in the manifest
 *
 * Generic successor to retold-manager's loader: the hardcoded TitleCase→disk group alias table is
 * gone (disk name now comes from Groups[].DiskName / Path), manifest discovery is git-style walk-up
 * (via ManifestLocator), and "ecosystem membership" is configurable (default: manifest-presence).
 *
 * Plain module — no fable/pict dependency, so it is require-and-go and trivially unit-testable.
 */
const libFS = require('fs');
const libPath = require('path');

const libManifestLocator = require('./Manager-Core-ManifestLocator.js');

const DEFAULT_MODULES_DIR = 'modules';

class ManifestLoader
{
	/**
	 * @param {object} [pOptions]
	 * @param {string} [pOptions.ManifestPath]    - Explicit path to the manifest JSON.
	 * @param {string} [pOptions.StartDirectory]  - Directory to search up from when ManifestPath is absent (default: cwd).
	 * @param {string} [pOptions.ManifestFileName]- Manifest filename to search for (default: Modules-Manifest.json).
	 * @param {string} [pOptions.RepoRoot]        - Override the repo root (default: the manifest's directory, or raw.RepoRoot).
	 */
	constructor(pOptions)
	{
		let tmpOptions = pOptions || {};
		this.options = tmpOptions;

		this.explicitManifestPath = tmpOptions.ManifestPath || null;
		this.startDirectory = tmpOptions.StartDirectory || process.cwd();
		this.manifestFileName = tmpOptions.ManifestFileName || libManifestLocator.DEFAULT_MANIFEST_FILENAME;
		this.repoRootOverride = tmpOptions.RepoRoot || null;

		this.manifestPath = null;
		this.repoRoot = null;
		this.modulesDir = DEFAULT_MODULES_DIR;

		this.raw = null;
		this.groups = null;
		this.moduleByName = null;
		this.groupByName = null;
		this.ecosystemNames = null;
	}

	/**
	 * Resolve the manifest path (explicit, else walk-up discovery).
	 * @returns {string} absolute manifest path
	 */
	resolveManifestPath()
	{
		if (this.explicitManifestPath)
		{
			return libPath.resolve(this.explicitManifestPath);
		}
		let tmpFound = libManifestLocator.locate(this.startDirectory, this.manifestFileName);
		if (!tmpFound)
		{
			throw new Error(`No ${this.manifestFileName} found (searched upward from ${this.startDirectory}).`);
		}
		return tmpFound;
	}

	/**
	 * Load (or reload) the manifest from disk. Safe to call repeatedly.
	 * @returns {ManifestLoader} this (for chaining)
	 */
	load()
	{
		this.manifestPath = this.resolveManifestPath();

		let tmpContent = libFS.readFileSync(this.manifestPath, 'utf8');
		this.raw = JSON.parse(tmpContent);

		if (!this.raw || !Array.isArray(this.raw.Groups))
		{
			throw new Error(`Manifest at ${this.manifestPath} has no Groups array`);
		}

		// Repo root: explicit override > manifest.RepoRoot (relative to the manifest) > the manifest's directory.
		let tmpManifestDir = libPath.dirname(this.manifestPath);
		if (this.repoRootOverride)
		{
			this.repoRoot = libPath.resolve(this.repoRootOverride);
		}
		else if (typeof this.raw.RepoRoot === 'string' && this.raw.RepoRoot.length > 0)
		{
			this.repoRoot = libPath.resolve(tmpManifestDir, this.raw.RepoRoot);
		}
		else
		{
			this.repoRoot = tmpManifestDir;
		}

		this.modulesDir = this.raw.ModulesDir || DEFAULT_MODULES_DIR;

		this.groups = this.raw.Groups;
		this.moduleByName = new Map();
		this.groupByName = new Map();
		this.ecosystemNames = new Set();

		for (let i = 0; i < this.groups.length; i++)
		{
			let tmpGroup = this.groups[i];
			this.groupByName.set(tmpGroup.Name, tmpGroup);

			let tmpDiskName = this.getGroupDiskName(tmpGroup);
			let tmpGroupFolder = this.getGroupFolder(tmpGroup, tmpDiskName);

			let tmpModules = Array.isArray(tmpGroup.Modules) ? tmpGroup.Modules : [];
			for (let j = 0; j < tmpModules.length; j++)
			{
				let tmpModule = tmpModules[j];

				// AbsolutePath: the entry's own `Path` WINS (resolved vs repo root), so a module or
				// service living in an arbitrary folder participates without special-casing. Falls
				// back to <groupFolder>/<Name>.
				let tmpAbsolutePath;
				if (typeof tmpModule.Path === 'string' && tmpModule.Path.length > 0)
				{
					tmpAbsolutePath = libPath.resolve(this.repoRoot, tmpModule.Path);
				}
				else
				{
					tmpAbsolutePath = libPath.join(tmpGroupFolder, tmpModule.Name);
				}

				let tmpEntry = Object.assign({}, tmpModule,
					{
						GroupName: tmpGroup.Name,
						GroupDiskName: tmpDiskName,
						AbsolutePath: tmpAbsolutePath
					});
				this.moduleByName.set(tmpModule.Name, tmpEntry);
				this.ecosystemNames.add(tmpModule.Name);
			}
		}

		return this;
	}

	ensureLoaded()
	{
		if (!this.raw) { this.load(); }
		return this;
	}

	// ─── Group helpers ───────────────────────────────────────────

	/**
	 * Disk directory name for a group: explicit DiskName > basename(Path) > lowercased Name.
	 */
	getGroupDiskName(pGroup)
	{
		if (pGroup.DiskName)
		{
			return pGroup.DiskName;
		}
		if (pGroup.Path)
		{
			return libPath.basename(pGroup.Path);
		}
		return String(pGroup.Name || '').toLowerCase();
	}

	/**
	 * Absolute folder that holds a group's modules: <repoRoot>/<Path> if declared,
	 * else <repoRoot>/<modulesDir>/<diskName>.
	 */
	getGroupFolder(pGroup, pDiskName)
	{
		let tmpDiskName = pDiskName || this.getGroupDiskName(pGroup);
		if (pGroup.Path)
		{
			return libPath.resolve(this.repoRoot, pGroup.Path);
		}
		return libPath.resolve(this.repoRoot, this.modulesDir, tmpDiskName);
	}

	// ─── Queries ─────────────────────────────────────────────────

	getModule(pName)
	{
		this.ensureLoaded();
		return this.moduleByName.get(pName) || null;
	}

	getGroup(pName)
	{
		this.ensureLoaded();
		return this.groupByName.get(pName) || null;
	}

	getAllModules()
	{
		this.ensureLoaded();
		return Array.from(this.moduleByName.values());
	}

	getAllModuleNames()
	{
		this.ensureLoaded();
		return Array.from(this.ecosystemNames);
	}

	getGroups()
	{
		this.ensureLoaded();
		return this.groups.slice();
	}

	getRepoRoot()
	{
		this.ensureLoaded();
		return this.repoRoot;
	}

	getManifestPath()
	{
		this.ensureLoaded();
		return this.manifestPath;
	}

	// ─── Config accessors ────────────────────────────────────────

	/**
	 * The tool's runtime config, drawn from top-level manifest keys with sane defaults.
	 */
	getConfig()
	{
		this.ensureLoaded();
		let tmpRaw = this.raw;
		return {
			SchemaVersion: tmpRaw.SchemaVersion || null,
			Name: tmpRaw.Name || null,
			GitRemote: tmpRaw.GitRemote || 'origin',
			DefaultBranch: tmpRaw.DefaultBranch || 'main',
			Org: tmpRaw.Org || null,
			GitTemplate: tmpRaw.GitTemplate || 'https://github.com/{org}/{name}.git',
			DocsTemplate: tmpRaw.DocsTemplate || null,
			EcosystemMembership: tmpRaw.EcosystemMembership || { Mode: 'manifest', Scopes: [] },
			Ripple: tmpRaw.Ripple || {},
			VersionSource: tmpRaw.VersionSource || 'highest-in-repo',
			Docs: tmpRaw.Docs || { Path: 'docs', Engine: null },
			DevServers: tmpRaw.DevServers || {},
			Logging: tmpRaw.Logging || { LogFilePrefix: 'Monorepo-Manager-Operations-', LogDir: '.', Sink: 'file' },
			Auth: tmpRaw.Auth || { Enabled: false, Provider: null },
			WebServer: tmpRaw.WebServer || { Port: 44444, Host: '127.0.0.1' }
		};
	}

	/**
	 * Is a dependency package name "in-ecosystem" for stale-dep checks and ripple edges?
	 * Default semantics are manifest-presence (matching retold-manager); npm-scope prefixes
	 * are additive and only apply when configured. NEVER silently exclude manifest modules.
	 *
	 * @param {string} pDependencyName
	 * @returns {boolean}
	 */
	isEcosystemDependency(pDependencyName)
	{
		this.ensureLoaded();
		let tmpMembership = (this.raw.EcosystemMembership) || { Mode: 'manifest', Scopes: [] };
		let tmpMode = tmpMembership.Mode || 'manifest';
		let tmpScopes = Array.isArray(tmpMembership.Scopes) ? tmpMembership.Scopes : [];

		let tmpInManifest = this.ecosystemNames.has(pDependencyName);
		let tmpInScopes = tmpScopes.some((pScope) => (typeof pScope === 'string' && pDependencyName.indexOf(pScope) === 0));

		if (tmpMode === 'scopes')
		{
			return tmpInScopes;
		}
		if (tmpMode === 'both')
		{
			return tmpInManifest || tmpInScopes;
		}
		// Default 'manifest'
		return tmpInManifest;
	}
}

module.exports = ManifestLoader;
module.exports.DEFAULT_MODULES_DIR = DEFAULT_MODULES_DIR;
