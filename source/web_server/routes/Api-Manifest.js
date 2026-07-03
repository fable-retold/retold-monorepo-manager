/**
 * Api-Manifest — read-only manifest / catalog / status routes.
 *
 * All GET. Backed by pCore.Loader (ManifestLoader) + pCore.Introspector (origin-only). The scan
 * response is origin-only — no fork/upstream fields (they were deleted with the fork model).
 *
 * Route order matters: /modules/scan and /modules/published-versions register BEFORE /modules/:name
 * so the literal paths aren't swallowed by the param route.
 */
function respondError(pRes, pStatus, pCode, pMessage)
{
	pRes.statusCode = pStatus;
	pRes.send({ Error: pCode, Message: pMessage });
}

function categorizeDeps(pLoader, pDependencies)
{
	let tmpEcosystem = [];
	let tmpExternal = [];
	let tmpNames = Object.keys(pDependencies || {});
	for (let i = 0; i < tmpNames.length; i++)
	{
		let tmpName = tmpNames[i];
		let tmpRecord = { Name: tmpName, Range: pDependencies[tmpName] };
		if (pLoader.isEcosystemDependency(tmpName)) { tmpEcosystem.push(tmpRecord); }
		else { tmpExternal.push(tmpRecord); }
	}
	return { Ecosystem: tmpEcosystem, External: tmpExternal };
}

module.exports = function registerManifestRoutes(pCore)
{
	let tmpOrator = pCore.Orator;
	let tmpLoader = pCore.Loader;
	let tmpIntrospector = pCore.Introspector;

	// Raw manifest.
	tmpOrator.serviceServer.doGet('/api/manager/manifest', function (pReq, pRes, pNext)
		{
			pRes.send(tmpLoader.raw);
			return pNext();
		});

	// Group metadata.
	tmpOrator.serviceServer.doGet('/api/manager/groups', function (pReq, pRes, pNext)
		{
			let tmpGroups = tmpLoader.getGroups().map((pGroup) =>
				({
					Name: pGroup.Name,
					Description: pGroup.Description || '',
					Path: pGroup.Path || null,
					ModuleCount: Array.isArray(pGroup.Modules) ? pGroup.Modules.length : 0
				}));
			pRes.send(tmpGroups);
			return pNext();
		});

	// Flat module list.
	tmpOrator.serviceServer.doGet('/api/manager/modules', function (pReq, pRes, pNext)
		{
			let tmpModules = tmpLoader.getAllModules().map((pModule) =>
				({
					Name: pModule.Name,
					Group: pModule.GroupName,
					GroupDiskName: pModule.GroupDiskName,
					Path: pModule.Path || null,
					Description: pModule.Description || '',
					GitHub: (pModule.GitHub === undefined) ? null : pModule.GitHub,
					Documentation: (pModule.Documentation === undefined) ? null : pModule.Documentation,
					RelatedModules: pModule.RelatedModules || [],
					Type: pModule.Type || 'library'
				}));
			pRes.send(tmpModules);
			return pNext();
		});

	// Parallel origin-only git-status sweep.
	tmpOrator.serviceServer.doGet('/api/manager/modules/scan', function (pReq, pRes, pNext)
		{
			let tmpStartedAt = Date.now();
			Promise.resolve(tmpIntrospector.scanAllModulesAsync({})).then(
				(pResults) =>
				{
					pRes.send(
						{
							ScannedAt: new Date().toISOString(),
							ElapsedMs: Date.now() - tmpStartedAt,
							ModuleCount: Object.keys(pResults).length,
							Results: pResults
						});
					return pNext();
				},
				(pError) =>
				{
					respondError(pRes, 500, 'ScanFailed', pError.message);
					return pNext();
				});
		});

	// npm published-version decoration pass (keyed by module name for client merge).
	tmpOrator.serviceServer.doGet('/api/manager/modules/published-versions', function (pReq, pRes, pNext)
		{
			let tmpStartedAt = Date.now();
			let tmpFilter = (pReq.query && pReq.query.names) ? String(pReq.query.names).split(',').map((pName) => pName.trim()).filter(Boolean) : null;

			let tmpModules = tmpLoader.getAllModules();
			let tmpByPackage = {};
			let tmpPackageNames = [];
			for (let i = 0; i < tmpModules.length; i++)
			{
				let tmpPackage = tmpIntrospector.readPackageJson(tmpModules[i].Name);
				let tmpPackageName = tmpPackage && tmpPackage.name;
				if (!tmpPackageName) { continue; }
				if (tmpFilter && tmpFilter.indexOf(tmpModules[i].Name) < 0) { continue; }
				tmpByPackage[tmpPackageName] = tmpModules[i].Name;
				tmpPackageNames.push(tmpPackageName);
			}

			Promise.resolve(tmpIntrospector.fetchPublishedVersionsParallel(tmpPackageNames, {})).then(
				(pVersions) =>
				{
					let tmpResults = {};
					Object.keys(pVersions).forEach((pPackageName) =>
						{
							let tmpModuleName = tmpByPackage[pPackageName];
							tmpResults[tmpModuleName] = { PackageName: pPackageName, PublishedVersion: pVersions[pPackageName] || null };
						});
					pRes.send({ FetchedAt: new Date().toISOString(), ElapsedMs: Date.now() - tmpStartedAt, Results: tmpResults });
					return pNext();
				},
				(pError) =>
				{
					respondError(pRes, 500, 'PublishedVersionsFailed', pError.message);
					return pNext();
				});
		});

	// Single-module detail.
	tmpOrator.serviceServer.doGet('/api/manager/modules/:name', function (pReq, pRes, pNext)
		{
			let tmpName = pReq.params.name;
			let tmpModule = tmpLoader.getModule(tmpName);
			if (!tmpModule)
			{
				respondError(pRes, 404, 'UnknownModule', `Unknown module: ${tmpName}`);
				return pNext();
			}

			let tmpPackage = tmpIntrospector.readPackageJson(tmpName);
			let tmpGitStatus = tmpIntrospector.getGitStatus(tmpName);

			let tmpResponse =
				{
					Manifest:
						{
							Name: tmpModule.Name,
							Group: tmpModule.GroupName,
							GroupDiskName: tmpModule.GroupDiskName,
							Path: tmpModule.Path || null,
							AbsolutePath: tmpModule.AbsolutePath,
							Description: tmpModule.Description || '',
							GitHub: (tmpModule.GitHub === undefined) ? null : tmpModule.GitHub,
							Documentation: (tmpModule.Documentation === undefined) ? null : tmpModule.Documentation,
							RelatedModules: tmpModule.RelatedModules || [],
							Type: tmpModule.Type || 'library',
							Service: tmpModule.Service || null
						},
					Package: tmpPackage
						? {
							Name: tmpPackage.name,
							Version: tmpPackage.version,
							Description: tmpPackage.description,
							Dependencies: tmpPackage.dependencies || {},
							DevDependencies: tmpPackage.devDependencies || {},
							Scripts: tmpPackage.scripts || {}
						}
						: null,
					GitStatus: tmpGitStatus,
					CategorizedDeps: tmpPackage
						? {
							Dependencies: categorizeDeps(tmpLoader, tmpPackage.dependencies),
							DevDependencies: categorizeDeps(tmpLoader, tmpPackage.devDependencies)
						}
						: null
				};
			pRes.send(tmpResponse);
			return pNext();
		});
};
