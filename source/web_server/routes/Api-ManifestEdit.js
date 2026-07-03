/**
 * Api-ManifestEdit — manifest audit / reload / backfill + module & group CRUD.
 * Every mutation writes the manifest atomically (tmp+rename via ManifestTools) then reloads the
 * in-memory index. No fork fields (Forkable/Owner) are ever written.
 */
const libManifestTools = require('../../core/Manager-Core-ManifestTools.js');

const ALLOWED_MODULE_FIELDS = [ 'Name', 'Path', 'Description', 'GitHub', 'Documentation', 'RelatedModules', 'Type', 'DocsPath', 'Service' ];

function respondError(pRes, pStatus, pCode, pMessage)
{
	pRes.statusCode = pStatus;
	pRes.send({ Error: pCode, Message: pMessage });
}

module.exports = function registerManifestEditRoutes(pCore)
{
	let tmpOrator = pCore.Orator;
	let tmpLoader = pCore.Loader;

	function saveAndReload()
	{
		let tmpText = JSON.stringify(tmpLoader.raw, null, '\t') + '\n';
		libManifestTools.atomicWrite(tmpLoader.getManifestPath(), tmpText);
		tmpLoader.load();
	}

	function findGroup(pName)
	{
		return (tmpLoader.raw.Groups || []).find((pGroup) => (pGroup.Name === pName)) || null;
	}

	function findModule(pName)
	{
		let tmpGroups = tmpLoader.raw.Groups || [];
		for (let i = 0; i < tmpGroups.length; i++)
		{
			let tmpModules = tmpGroups[i].Modules || [];
			for (let j = 0; j < tmpModules.length; j++)
			{
				if (tmpModules[j].Name === pName) { return { Group: tmpGroups[i], Module: tmpModules[j], Index: j }; }
			}
		}
		return null;
	}

	// Audit (manifest vs disk).
	tmpOrator.serviceServer.doGet('/api/manager/manifest/audit', function (pReq, pRes, pNext)
		{
			let tmpReport = libManifestTools.audit(tmpLoader);
			pRes.send(tmpReport);
			return pNext();
		});

	// Reload from disk.
	tmpOrator.serviceServer.doPost('/api/manager/manifest/reload', function (pReq, pRes, pNext)
		{
			tmpLoader.load();
			pRes.send({ Reloaded: true, ModuleCount: tmpLoader.getAllModuleNames().length });
			return pNext();
		});

	// Backfill (add on-disk modules missing from the manifest).
	tmpOrator.serviceServer.doPost('/api/manager/manifest/backfill', function (pReq, pRes, pNext)
		{
			let tmpBody = pReq.body || {};
			let tmpResult = libManifestTools.backfill(tmpLoader, { Write: tmpBody.Write === true });
			if (tmpResult.Written) { tmpLoader.load(); }
			pRes.send({ Added: tmpResult.Added, Written: tmpResult.Written });
			return pNext();
		});

	// Add a module entry.
	tmpOrator.serviceServer.doPost('/api/manager/manifest/modules', function (pReq, pRes, pNext)
		{
			let tmpBody = pReq.body || {};
			if (!tmpBody.Group || !tmpBody.Name) { respondError(pRes, 400, 'BadRequest', 'Group and Name are required.'); return pNext(); }

			let tmpGroup = findGroup(tmpBody.Group);
			if (!tmpGroup) { respondError(pRes, 404, 'UnknownGroup', `Unknown group: ${tmpBody.Group}`); return pNext(); }
			if (findModule(tmpBody.Name)) { respondError(pRes, 409, 'DuplicateModule', `Module already exists: ${tmpBody.Name}`); return pNext(); }

			let tmpConfig = tmpLoader.getConfig();
			let tmpDiskName = tmpLoader.getGroupDiskName(tmpGroup);
			let tmpEntry =
				{
					Name: tmpBody.Name,
					Path: tmpBody.Path || (tmpGroup.Path ? `${tmpGroup.Path}/${tmpBody.Name}` : `${tmpLoader.modulesDir}/${tmpDiskName}/${tmpBody.Name}`),
					Type: tmpBody.Type || 'library',
					Description: tmpBody.Description || '',
					GitHub: (tmpBody.GitHub !== undefined) ? tmpBody.GitHub : (tmpConfig.Org && tmpConfig.GitTemplate ? tmpConfig.GitTemplate.split('{org}').join(tmpConfig.Org).split('{name}').join(tmpBody.Name) : null),
					Documentation: (tmpBody.Documentation !== undefined) ? tmpBody.Documentation : (tmpConfig.Org && tmpConfig.DocsTemplate ? tmpConfig.DocsTemplate.split('{org}').join(tmpConfig.Org).split('{name}').join(tmpBody.Name) : null),
					RelatedModules: tmpBody.RelatedModules || []
				};

			if (!Array.isArray(tmpGroup.Modules)) { tmpGroup.Modules = []; }
			tmpGroup.Modules.push(tmpEntry);
			try { saveAndReload(); }
			catch (pError) { respondError(pRes, 500, 'WriteFailed', pError.message); return pNext(); }

			pRes.statusCode = 201;
			pRes.send(tmpLoader.getModule(tmpBody.Name));
			return pNext();
		});

	// Update a module entry.
	tmpOrator.serviceServer.doPatch('/api/manager/manifest/modules/:name', function (pReq, pRes, pNext)
		{
			let tmpFound = findModule(pReq.params.name);
			if (!tmpFound) { respondError(pRes, 404, 'UnknownModule', `Unknown module: ${pReq.params.name}`); return pNext(); }

			let tmpBody = pReq.body || {};
			if (tmpBody.Name && tmpBody.Name !== pReq.params.name && findModule(tmpBody.Name))
			{
				respondError(pRes, 409, 'DuplicateModule', `Module already exists: ${tmpBody.Name}`);
				return pNext();
			}

			for (let i = 0; i < ALLOWED_MODULE_FIELDS.length; i++)
			{
				let tmpField = ALLOWED_MODULE_FIELDS[i];
				if (Object.prototype.hasOwnProperty.call(tmpBody, tmpField)) { tmpFound.Module[tmpField] = tmpBody[tmpField]; }
			}
			try { saveAndReload(); }
			catch (pError) { respondError(pRes, 500, 'WriteFailed', pError.message); return pNext(); }

			pRes.send(tmpLoader.getModule(tmpFound.Module.Name));
			return pNext();
		});

	// Delete a module entry.
	tmpOrator.serviceServer.doDel('/api/manager/manifest/modules/:name', function (pReq, pRes, pNext)
		{
			let tmpFound = findModule(pReq.params.name);
			if (!tmpFound) { respondError(pRes, 404, 'UnknownModule', `Unknown module: ${pReq.params.name}`); return pNext(); }

			tmpFound.Group.Modules.splice(tmpFound.Index, 1);
			try { saveAndReload(); }
			catch (pError) { respondError(pRes, 500, 'WriteFailed', pError.message); return pNext(); }

			pRes.send({ Deleted: pReq.params.name });
			return pNext();
		});

	// Set a group's description.
	tmpOrator.serviceServer.doPut('/api/manager/manifest/groups/:name', function (pReq, pRes, pNext)
		{
			let tmpGroup = findGroup(pReq.params.name);
			if (!tmpGroup) { respondError(pRes, 404, 'UnknownGroup', `Unknown group: ${pReq.params.name}`); return pNext(); }

			let tmpBody = pReq.body || {};
			if (tmpBody.Description !== undefined) { tmpGroup.Description = tmpBody.Description; }
			try { saveAndReload(); }
			catch (pError) { respondError(pRes, 500, 'WriteFailed', pError.message); return pNext(); }

			pRes.send({ Name: tmpGroup.Name, Description: tmpGroup.Description });
			return pNext();
		});
};
