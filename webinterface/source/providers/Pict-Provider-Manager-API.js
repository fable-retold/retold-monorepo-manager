const libPictProvider = require('pict-provider');

const API_BASE = '/api/manager';

/**
 * Pict-Provider-Manager-API — the REST client for the Monorepo Manager web server. One method per
 * user intent; every write op returns { OperationId } and streams over the WebSocket. No fork/PR
 * methods exist.
 */
class ManagerAPIProvider extends libPictProvider
{
	constructor(pFable, pOptions, pServiceHash)
	{
		super(pFable, pOptions, pServiceHash);
	}

	// ─── fetch helpers ───────────────────────────────────────────
	async _parse(pResponse)
	{
		let tmpText = await pResponse.text();
		let tmpBody;
		try { tmpBody = tmpText ? JSON.parse(tmpText) : {}; }
		catch (pError) { tmpBody = { Message: tmpText }; }
		if (!pResponse.ok)
		{
			let tmpError = new Error(tmpBody.Message || ('HTTP ' + pResponse.status));
			tmpError.Status = pResponse.status;
			tmpError.Info = tmpBody;
			throw tmpError;
		}
		return tmpBody;
	}

	async get(pPath)
	{
		return this._parse(await fetch(API_BASE + pPath, { headers: { Accept: 'application/json' } }));
	}

	async request(pMethod, pPath, pBody)
	{
		let tmpOptions = { method: pMethod, headers: { Accept: 'application/json' } };
		if (pBody !== undefined && pBody !== null)
		{
			tmpOptions.headers['Content-Type'] = 'application/json';
			tmpOptions.body = JSON.stringify(pBody);
		}
		return this._parse(await fetch(API_BASE + pPath, tmpOptions));
	}

	post(pPath, pBody) { return this.request('POST', pPath, pBody); }
	patch(pPath, pBody) { return this.request('PATCH', pPath, pBody); }
	del(pPath) { return this.request('DELETE', pPath); }

	_rerender(pViewHash)
	{
		let tmpView = this.pict.views[pViewHash];
		if (tmpView && typeof tmpView.render === 'function') { tmpView.render(); }
	}

	// Home shares the center destination (#RM-Workspace-Content) with the module workspace, the bulk
	// wizard, and the manifest editor. Only refresh it when Home is the active route — otherwise a
	// background scan / module load would clobber whatever center view the user is on.
	_rerenderHomeIfActive()
	{
		if (this.pict.AppData.Manager.CurrentRoute === 'Home') { this._rerender('Manager-Home'); }
	}

	// The scan/modules table also lives in the center; refresh it when it's the active route.
	_rerenderScanIfActive()
	{
		if (this.pict.AppData.Manager.CurrentRoute === 'Modules') { this._rerender('Manager-ScanTable'); }
	}

	// ─── reads ───────────────────────────────────────────────────
	async loadModules()
	{
		let tmpModules = await this.get('/modules');
		this.pict.AppData.Manager.Modules = tmpModules;
		let tmpByGroup = {};
		for (let i = 0; i < tmpModules.length; i++)
		{
			let tmpGroup = tmpModules[i].Group || 'Ungrouped';
			if (!tmpByGroup[tmpGroup]) { tmpByGroup[tmpGroup] = []; }
			tmpByGroup[tmpGroup].push(tmpModules[i]);
		}
		this.pict.AppData.Manager.ModulesByGroup = tmpByGroup;
		this._rerender('Manager-ModuleList');
		this._rerenderHomeIfActive();
		return tmpModules;
	}

	async scanAllModules()
	{
		this.pict.AppData.Manager.Scan.Running = true;
		this._rerender('Manager-ModuleList');
		try
		{
			let tmpResult = await this.get('/modules/scan');
			this.pict.AppData.Manager.Scan.Results = tmpResult.Results || {};
			this.pict.AppData.Manager.Scan.When = tmpResult.ScannedAt;
		}
		finally { this.pict.AppData.Manager.Scan.Running = false; }
		this._rerender('Manager-ModuleList');
		this._rerenderHomeIfActive();
		this._rerenderScanIfActive();
		// Fire-and-forget npm published-version decoration.
		this.loadPublishedVersions().catch(() => {});
		return this.pict.AppData.Manager.Scan.Results;
	}

	async loadPublishedVersions()
	{
		let tmpResult = await this.get('/modules/published-versions');
		let tmpResults = tmpResult.Results || {};
		let tmpScan = this.pict.AppData.Manager.Scan.Results;
		Object.keys(tmpResults).forEach((pName) =>
			{
				if (tmpScan[pName]) { tmpScan[pName].PublishedVersion = tmpResults[pName].PublishedVersion; tmpScan[pName].VersionState = tmpResults[pName].VersionState || tmpScan[pName].VersionState; }
			});
		this._rerender('Manager-ModuleList');
		this._rerenderScanIfActive();
		return tmpResults;
	}

	async loadModuleDetail(pName)
	{
		let tmpDetail = await this.get('/modules/' + encodeURIComponent(pName));
		this.pict.AppData.Manager.SelectedModuleDetail = tmpDetail;
		return tmpDetail;
	}

	pollHealth()
	{
		let tmpSelf = this;
		async function tick()
		{
			try
			{
				let tmpHealth = await tmpSelf.get('/health');
				tmpSelf.pict.AppData.Manager.Health = { state: 'ok', text: tmpHealth.ModuleCount + ' modules' };
			}
			catch (pError) { tmpSelf.pict.AppData.Manager.Health = { state: 'down', text: 'offline' }; }
			tmpSelf._rerender('Manager-TopBar-Nav');
		}
		tick();
		this._healthTimer = setInterval(tick, 30000);
		if (this._healthTimer.unref) { this._healthTimer.unref(); }
	}

	// ─── supervised services (config-driven; empty unless the manifest declares Service/DevServers) ─
	loadServices() { return this.get('/services'); }
	startService(pKey, pParams) { return this.post('/services/' + encodeURIComponent(pKey) + '/start', pParams || {}); }
	stopService(pKey) { return this.post('/services/' + encodeURIComponent(pKey) + '/stop', {}); }

	pollServices()
	{
		let tmpSelf = this;
		async function tick()
		{
			try { let tmpResult = await tmpSelf.get('/services'); tmpSelf.pict.AppData.Manager.Services = tmpResult.Services || {}; }
			catch (pError) { tmpSelf.pict.AppData.Manager.Services = {}; }
			tmpSelf._rerender('Manager-TopBar-Nav');
		}
		tick();
		this._servicesTimer = setInterval(tick, 15000);
		if (this._servicesTimer.unref) { this._servicesTimer.unref(); }
	}

	fetchGitDiffText(pName)
	{
		return fetch(API_BASE + '/modules/' + encodeURIComponent(pName) + '/git/diff', { headers: { Accept: 'text/plain' } }).then((pR) => pR.text());
	}

	// ─── operations (return { OperationId }) ─────────────────────
	runModuleOperation(pName, pCommand, pArgs, pLabel) { return this.post('/modules/' + encodeURIComponent(pName) + '/operations/run', { Command: pCommand, Args: pArgs, Label: pLabel }); }
	// Repo-wide fan-out now lives in the bulk-operation engine (see Pict-Provider-Manager-Bulk).
	runModuleDiff(pName) { return this.post('/modules/' + encodeURIComponent(pName) + '/operations/diff', {}); }
	bumpVersion(pName, pKind, pVersion) { return this.post('/modules/' + encodeURIComponent(pName) + '/operations/version', { Kind: pKind, Version: pVersion }); }
	gitAddAll(pName) { return this.post('/modules/' + encodeURIComponent(pName) + '/operations/git-add', { All: true }); }
	gitAddPaths(pName, pPaths) { return this.post('/modules/' + encodeURIComponent(pName) + '/operations/git-add', { Paths: pPaths }); }
	commitModule(pName, pMessage) { return this.post('/modules/' + encodeURIComponent(pName) + '/operations/commit', { Message: pMessage }); }
	runNcu(pName, pApply, pScope) { return this.post('/modules/' + encodeURIComponent(pName) + '/operations/ncu', { Apply: pApply, Scope: pScope }); }
	runNpmCacheOperation(pAction) { return this.post('/system/operations/npm-cache', { Action: pAction }); }
	cancelOperation(pOperationId) { return this.post('/operations/' + encodeURIComponent(pOperationId) + '/cancel', {}); }
	fetchLog(pTail) { return this.get('/log?tail=' + (pTail || 500)); }

	// ─── publish handshake ───────────────────────────────────────
	loadPublishPreview(pName) { return this.get('/modules/' + encodeURIComponent(pName) + '/publish/preview'); }
	publishModule(pName, pPreviewHash) { return this.post('/modules/' + encodeURIComponent(pName) + '/operations/publish', { Confirm: true, PreviewHash: pPreviewHash }); }

	// ─── manifest ────────────────────────────────────────────────
	loadManifest() { return this.get('/manifest'); }
	loadManifestAudit() { return this.get('/manifest/audit'); }
	createManifestModule(pEntry) { return this.post('/manifest/modules', pEntry); }
	updateManifestModule(pName, pEntry) { return this.patch('/manifest/modules/' + encodeURIComponent(pName), pEntry); }
	deleteManifestModule(pName) { return this.del('/manifest/modules/' + encodeURIComponent(pName)); }
}

ManagerAPIProvider.default_configuration =
	{
		ProviderIdentifier: 'ManagerAPI',
		AutoInitialize: true,
		AutoInitializeOrdinal: 1
	};

module.exports = ManagerAPIProvider;
