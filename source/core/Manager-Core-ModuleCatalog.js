/**
 * Manager-Core-ModuleCatalog
 *
 * Thin facade over a ManifestLoader. In retold-manager this was a process-wide singleton; here it
 * is a class so each CLI invocation (or web request) can catalog whichever monorepo it was pointed
 * at. A convenience `ModuleCatalog.forOptions(...)` builds and loads one in a single call.
 */
const libManifestLoader = require('./Manager-Core-ManifestLoader.js');

class ModuleCatalog
{
	/**
	 * @param {libManifestLoader|object} [pLoaderOrOptions] - A ManifestLoader instance, or options to build one.
	 */
	constructor(pLoaderOrOptions)
	{
		if (pLoaderOrOptions instanceof libManifestLoader)
		{
			this.loader = pLoaderOrOptions;
		}
		else
		{
			this.loader = new libManifestLoader(pLoaderOrOptions || {});
		}
	}

	/**
	 * Build a catalog and load its manifest immediately.
	 * @param {object} [pOptions] - ManifestLoader options ({ ManifestPath, StartDirectory, ... }).
	 * @returns {ModuleCatalog}
	 */
	static forOptions(pOptions)
	{
		let tmpCatalog = new ModuleCatalog(pOptions);
		tmpCatalog.loader.load();
		return tmpCatalog;
	}

	reload()
	{
		this.loader.load();
		return this;
	}

	getModule(pName)
	{
		return this.loader.getModule(pName);
	}

	getGroup(pName)
	{
		return this.loader.getGroup(pName);
	}

	getAllModules()
	{
		return this.loader.getAllModules();
	}

	getAllModuleNames()
	{
		return this.loader.getAllModuleNames();
	}

	getGroups()
	{
		return this.loader.getGroups();
	}

	getConfig()
	{
		return this.loader.getConfig();
	}

	getRepoRoot()
	{
		return this.loader.getRepoRoot();
	}

	getManifestPath()
	{
		return this.loader.getManifestPath();
	}

	isEcosystemDependency(pName)
	{
		return this.loader.isEcosystemDependency(pName);
	}
}

module.exports = ModuleCatalog;
