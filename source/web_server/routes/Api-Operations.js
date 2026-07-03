/**
 * Api-Operations — the write side: shelled operations, publish handshake, repo-wide fan-out, and
 * operation status/cancel/output/log. Fork/upstream routes (create-pr, sync-upstream, pr-context,
 * fetch-upstream, all sync-upstream) are intentionally absent.
 *
 * Kick-off recipe (every operation route):
 *   1. resolve module (404 UnknownModule) 2. if ProcessRunner.isRunning() → 409 RunnerBusy
 *   3. run(...) / runSequence(...) → OperationId  4. respond 202 { OperationId }
 *   Output streams over WebSocket /ws/manager/operations, correlated by OperationId.
 */
const libCommitComposer = require('../../core/Manager-Core-CommitComposer.js');
const libDepAligner = require('../../core/Manager-Core-DepAligner.js');

const PREVIEW_TTL_MS = 5 * 60 * 1000;

function respondError(pRes, pStatus, pCode, pMessage)
{
	pRes.statusCode = pStatus;
	pRes.send({ Error: pCode, Message: pMessage });
}

module.exports = function registerOperationsRoutes(pCore)
{
	let tmpOrator = pCore.Orator;
	let tmpLoader = pCore.Loader;
	let tmpIntrospector = pCore.Introspector;
	let tmpValidator = pCore.Validator;
	let tmpRunner = pCore.ProcessRunner;
	let tmpBroadcaster = pCore.Broadcaster;
	let tmpStreamBridge = pCore.StreamBridge;
	let tmpLogger = pCore.Logger;

	let _previews = new Map();
	function storePreview(pName, pReport) { _previews.set(pName, { Hash: pReport.PreviewHash, ExpiresAt: Date.now() + PREVIEW_TTL_MS, Report: pReport }); }
	function getStoredPreview(pName)
	{
		let tmpEntry = _previews.get(pName);
		if (!tmpEntry) { return null; }
		if (Date.now() > tmpEntry.ExpiresAt) { _previews.delete(pName); return null; }
		return tmpEntry;
	}

	function moduleOr404(pReq, pRes)
	{
		let tmpModule = tmpLoader.getModule(pReq.params.name);
		if (!tmpModule) { respondError(pRes, 404, 'UnknownModule', `Unknown module: ${pReq.params.name}`); return null; }
		return tmpModule;
	}

	function busy(pRes)
	{
		if (tmpRunner.isRunning())
		{
			respondError(pRes, 409, 'RunnerBusy', 'Another operation is still running. Cancel it first.');
			return true;
		}
		return false;
	}

	function kickRun(pRes, pModule, pRunOptions, pExtra)
	{
		let tmpOperationId = tmpRunner.run(Object.assign({ Cwd: pModule.AbsolutePath }, pRunOptions));
		pRes.statusCode = 202;
		pRes.send(Object.assign({ OperationId: tmpOperationId, Module: pModule.Name }, pExtra || {}));
	}

	function kickSequence(pRes, pCwd, pSequenceOptions, pExtra)
	{
		let tmpOperationId = tmpRunner.runSequence(Object.assign({ Cwd: pCwd }, pSequenceOptions));
		pRes.statusCode = 202;
		pRes.send(Object.assign({ OperationId: tmpOperationId }, pExtra || {}));
	}

	// ─── Generic per-module command wrapper ──────────────────────
	tmpOrator.serviceServer.doPost('/api/manager/modules/:name/operations/run', function (pReq, pRes, pNext)
		{
			let tmpModule = moduleOr404(pReq, pRes); if (!tmpModule) { return pNext(); }
			if (busy(pRes)) { return pNext(); }
			let tmpBody = pReq.body || {};
			if (!tmpBody.Command || !Array.isArray(tmpBody.Args)) { respondError(pRes, 400, 'BadRequest', 'Command (string) and Args (array) are required.'); return pNext(); }
			kickRun(pRes, tmpModule, { Command: tmpBody.Command, Args: tmpBody.Args, Label: tmpBody.Label || `${tmpBody.Command} ${tmpModule.Name}` });
			return pNext();
		});

	// ─── Diff (2-step: stat then full, excluding dist) ───────────
	tmpOrator.serviceServer.doPost('/api/manager/modules/:name/operations/diff', function (pReq, pRes, pNext)
		{
			let tmpModule = moduleOr404(pReq, pRes); if (!tmpModule) { return pNext(); }
			if (busy(pRes)) { return pNext(); }
			kickSequence(pRes, tmpModule.AbsolutePath,
				{
					Steps:
					[
						{ Command: 'git', Args: [ 'diff', '--stat' ], Label: `diff --stat ${tmpModule.Name}` },
						{ Command: 'git', Args: [ 'diff', '--', '.', ':!dist' ], Label: `diff ${tmpModule.Name}` }
					]
				},
				{ Module: tmpModule.Name });
			return pNext();
		});

	// ─── Version bump (no git tag) ───────────────────────────────
	tmpOrator.serviceServer.doPost('/api/manager/modules/:name/operations/version', function (pReq, pRes, pNext)
		{
			let tmpModule = moduleOr404(pReq, pRes); if (!tmpModule) { return pNext(); }
			if (busy(pRes)) { return pNext(); }
			let tmpBody = pReq.body || {};
			let tmpKind = tmpBody.Kind;
			let tmpBumpArg = (tmpKind === 'explicit') ? tmpBody.Version : tmpKind;
			if (!tmpBumpArg) { respondError(pRes, 400, 'BadRequest', 'Kind (patch|minor|major|explicit) is required; explicit needs Version.'); return pNext(); }
			_previews.delete(tmpModule.Name);
			kickRun(pRes, tmpModule, { Command: 'npm', Args: [ 'version', tmpBumpArg, '--no-git-tag-version' ], Label: `version ${tmpModule.Name}` }, { Kind: tmpKind });
			return pNext();
		});

	// ─── git add ─────────────────────────────────────────────────
	tmpOrator.serviceServer.doPost('/api/manager/modules/:name/operations/git-add', function (pReq, pRes, pNext)
		{
			let tmpModule = moduleOr404(pReq, pRes); if (!tmpModule) { return pNext(); }
			if (busy(pRes)) { return pNext(); }
			let tmpBody = pReq.body || {};
			let tmpArgs = [ 'add' ];
			if (tmpBody.All === true) { tmpArgs.push('-A'); }
			else if (Array.isArray(tmpBody.Paths) && tmpBody.Paths.length > 0)
			{
				for (let i = 0; i < tmpBody.Paths.length; i++)
				{
					let tmpPath = tmpBody.Paths[i];
					if (typeof tmpPath !== 'string' || tmpPath.length === 0 || tmpPath.charAt(0) === '-' || tmpPath.charAt(0) === '/')
					{
						respondError(pRes, 400, 'BadPath', `Illegal path: ${tmpPath}`); return pNext();
					}
				}
				tmpArgs = tmpArgs.concat([ '--' ], tmpBody.Paths);
			}
			else { respondError(pRes, 400, 'BadRequest', 'Provide All:true or a non-empty Paths array.'); return pNext(); }
			kickRun(pRes, tmpModule, { Command: 'git', Args: tmpArgs, Label: `add ${tmpModule.Name}` });
			return pNext();
		});

	// ─── Commit ──────────────────────────────────────────────────
	tmpOrator.serviceServer.doPost('/api/manager/modules/:name/operations/commit', function (pReq, pRes, pNext)
		{
			let tmpModule = moduleOr404(pReq, pRes); if (!tmpModule) { return pNext(); }
			if (busy(pRes)) { return pNext(); }
			let tmpBody = pReq.body || {};
			let tmpValidation = libCommitComposer.validateMessage(tmpBody.Message);
			if (!tmpValidation.Ok) { respondError(pRes, 400, 'BadRequest', tmpValidation.Problems.join(' ')); return pNext(); }
			let tmpBuilt = libCommitComposer.buildCommitArgs(tmpBody.Message, { AddAll: true });
			kickRun(pRes, tmpModule, { Command: tmpBuilt.Command, Args: tmpBuilt.Args, Label: `commit ${tmpModule.Name}` });
			return pNext();
		});

	// ─── ncu ─────────────────────────────────────────────────────
	tmpOrator.serviceServer.doPost('/api/manager/modules/:name/operations/ncu', function (pReq, pRes, pNext)
		{
			let tmpModule = moduleOr404(pReq, pRes); if (!tmpModule) { return pNext(); }
			if (busy(pRes)) { return pNext(); }
			let tmpBody = pReq.body || {};
			let tmpNcuArgs = [ 'npm-check-updates' ];
			if (tmpBody.Apply === true) { tmpNcuArgs.push('-u'); }
			if (tmpBody.Scope === 'ecosystem')
			{
				let tmpNames = tmpLoader.getAllModuleNames();
				if (tmpNames.length > 0) { tmpNcuArgs.push('--filter', tmpNames.join(',')); }
			}
			if (tmpBody.Apply === true)
			{
				kickSequence(pRes, tmpModule.AbsolutePath,
					{ AbortOnError: true, Steps: [ { Command: 'npx', Args: tmpNcuArgs, Label: `ncu -u ${tmpModule.Name}` }, { Command: 'npm', Args: [ 'install' ], Label: `install ${tmpModule.Name}` } ] },
					{ Module: tmpModule.Name });
			}
			else
			{
				kickRun(pRes, tmpModule, { Command: 'npx', Args: tmpNcuArgs, Label: `ncu ${tmpModule.Name}` });
			}
			return pNext();
		});

	// ─── Repo-wide dependency alignment (synchronous, no op stream) ─
	tmpOrator.serviceServer.doPost('/api/manager/deps/sync', function (pReq, pRes, pNext)
		{
			let tmpBody = pReq.body || {};
			let tmpResult = libDepAligner.align(tmpLoader, { Write: tmpBody.Write === true });
			pRes.send(tmpResult);
			return pNext();
		});

	// ─── Publish preview + guarded publish ───────────────────────
	tmpOrator.serviceServer.doGet('/api/manager/modules/:name/publish/preview', function (pReq, pRes, pNext)
		{
			let tmpModule = moduleOr404(pReq, pRes); if (!tmpModule) { return pNext(); }
			Promise.resolve(tmpValidator.validate(tmpModule.Name, {})).then(
				(pReport) => { storePreview(tmpModule.Name, pReport); pRes.send(pReport); return pNext(); },
				(pError) => { respondError(pRes, 500, 'ValidatorError', pError.message); return pNext(); });
		});

	tmpOrator.serviceServer.doPost('/api/manager/modules/:name/operations/publish', function (pReq, pRes, pNext)
		{
			let tmpModule = moduleOr404(pReq, pRes); if (!tmpModule) { return pNext(); }
			let tmpBody = pReq.body || {};
			if (tmpBody.Confirm !== true) { respondError(pRes, 400, 'BadRequest', 'Confirm:true is required.'); return pNext(); }
			if (!tmpBody.PreviewHash) { respondError(pRes, 400, 'BadRequest', 'PreviewHash is required.'); return pNext(); }
			let tmpStored = getStoredPreview(tmpModule.Name);
			if (!tmpStored) { respondError(pRes, 409, 'PreviewExpired', 'No current preview; re-run publish preview.'); return pNext(); }
			if (tmpStored.Hash !== tmpBody.PreviewHash) { respondError(pRes, 409, 'PreviewStale', 'Preview is stale; re-run publish preview.'); return pNext(); }
			if (!tmpStored.Report.OkToPublish) { respondError(pRes, 409, 'NotPublishable', 'Pre-publish validation failed.'); return pNext(); }
			if (busy(pRes)) { return pNext(); }
			_previews.delete(tmpModule.Name);
			kickRun(pRes, tmpModule, { Command: 'npm', Args: [ 'publish' ], Label: `publish ${tmpModule.Name}` }, { Version: tmpStored.Report.LocalVersion });
			return pNext();
		});

	// ─── Read-only git introspection ─────────────────────────────
	tmpOrator.serviceServer.doGet('/api/manager/modules/:name/git/diff', function (pReq, pRes, pNext)
		{
			let tmpModule = moduleOr404(pReq, pRes); if (!tmpModule) { return pNext(); }
			let tmpDiff = tmpIntrospector.getGitDiff(tmpModule.Name,
				{ Path: pReq.query && pReq.query.path, Staged: !!(pReq.query && pReq.query.staged), Stat: !!(pReq.query && pReq.query.stat) });
			pRes.setHeader('Content-Type', 'text/plain; charset=utf-8');
			pRes.send(tmpDiff || '');
			return pNext();
		});

	tmpOrator.serviceServer.doGet('/api/manager/modules/:name/git/log', function (pReq, pRes, pNext)
		{
			let tmpModule = moduleOr404(pReq, pRes); if (!tmpModule) { return pNext(); }
			let tmpLimit = (pReq.query && pReq.query.limit) ? parseInt(pReq.query.limit, 10) : 20;
			let tmpSince = (pReq.query && pReq.query.since) || null;
			let tmpLog = tmpIntrospector.getCommitLogSince(tmpModule.Name, tmpSince, { Limit: tmpLimit });
			pRes.send({ Module: tmpModule.Name, Log: tmpLog });
			return pNext();
		});

	// ─── Repo-wide fan-out is now the Bulk-Operation engine (Api-Bulk); the old `all` bash-loop
	//     routes were removed in Phase 5f. ───

	// ─── System: npm cache ───────────────────────────────────────
	tmpOrator.serviceServer.doPost('/api/manager/system/operations/npm-cache', function (pReq, pRes, pNext)
		{
			if (busy(pRes)) { return pNext(); }
			let tmpBody = pReq.body || {};
			let tmpArgs = (tmpBody.Action === 'clean') ? [ 'cache', 'clean', '--force' ] : (tmpBody.Action === 'verify') ? [ 'cache', 'verify' ] : null;
			if (!tmpArgs) { respondError(pRes, 400, 'BadAction', 'Action must be clean or verify.'); return pNext(); }
			let tmpOperationId = tmpRunner.run({ Command: 'npm', Args: tmpArgs, Cwd: tmpLoader.getRepoRoot(), Label: `npm cache ${tmpBody.Action}` });
			pRes.statusCode = 202;
			pRes.send({ OperationId: tmpOperationId });
			return pNext();
		});

	// ─── Operation status / cancel / output ──────────────────────
	tmpOrator.serviceServer.doGet('/api/manager/operations/:id', function (pReq, pRes, pNext)
		{
			let tmpId = pReq.params.id;
			pRes.send(
				{
					OperationId: tmpId,
					Running: tmpRunner.isRunning(tmpId),
					LineCount: tmpRunner.hasBuffer(tmpId) ? tmpRunner.getBuffer(tmpId).length : 0,
					Result: tmpStreamBridge.getRecentResult(tmpId)
				});
			return pNext();
		});

	tmpOrator.serviceServer.doPost('/api/manager/operations/:id/cancel', function (pReq, pRes, pNext)
		{
			let tmpId = pReq.params.id;
			if (!tmpRunner.isRunning(tmpId)) { respondError(pRes, 404, 'NotRunning', 'No such running operation.'); return pNext(); }
			tmpRunner.kill(tmpId);
			tmpBroadcaster.markCancelled(tmpId);
			tmpBroadcaster.broadcastCancelled(tmpId);
			pRes.send({ OperationId: tmpId, Cancelled: true });
			return pNext();
		});

	tmpOrator.serviceServer.doGet('/api/manager/operations/:id/output', function (pReq, pRes, pNext)
		{
			let tmpId = pReq.params.id;
			if (pReq.query && pReq.query.q) { pRes.send(tmpRunner.search(tmpId, pReq.query.q)); return pNext(); }
			let tmpBuffer = tmpRunner.hasBuffer(tmpId) ? tmpRunner.getBuffer(tmpId) : [];
			let tmpSince = (pReq.query && pReq.query.since) ? parseInt(pReq.query.since, 10) : 0;
			let tmpLimit = (pReq.query && pReq.query.limit) ? parseInt(pReq.query.limit, 10) : 5000;
			pRes.send({ OperationId: tmpId, Total: tmpBuffer.length, Since: tmpSince, Lines: tmpBuffer.slice(tmpSince, tmpSince + tmpLimit) });
			return pNext();
		});

	// ─── Durable operation log tail ──────────────────────────────
	tmpOrator.serviceServer.doGet('/api/manager/log', function (pReq, pRes, pNext)
		{
			if (!tmpLogger) { respondError(pRes, 404, 'NoLogger', 'No operation logger configured.'); return pNext(); }
			let tmpTail = (pReq.query && pReq.query.tail) ? Math.min(parseInt(pReq.query.tail, 10) || 500, 10000) : 500;
			let tmpPath = tmpLogger.getLogPath();
			let tmpFS = require('fs');
			if (!tmpFS.existsSync(tmpPath)) { pRes.send({ Path: tmpPath, Exists: false, Total: 0, Lines: [] }); return pNext(); }
			let tmpLines = tmpFS.readFileSync(tmpPath, 'utf8').split('\n').filter(Boolean);
			pRes.send({ Path: tmpPath, Exists: true, Total: tmpLines.length, Lines: tmpLines.slice(-tmpTail) });
			return pNext();
		});
};
