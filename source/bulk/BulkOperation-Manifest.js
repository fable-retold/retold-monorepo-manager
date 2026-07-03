/**
 * BulkOperation-Manifest — durable run persistence (ultravisor's ExecutionManifest, right-sized).
 *
 * Creates a run record from a plan, keeps an in-memory cache, and checkpoints the record to disk
 * (atomic tmp+rename) after every step/action/pause so a crashed or restarted server keeps history
 * and can resume. Runs live under `<LogDir>/.monorepo-manager-runs/<RunHash>.json`.
 */
const libFS = require('fs');
const libPath = require('path');

class BulkOperationManifest
{
	constructor(pOptions)
	{
		let tmpOptions = pOptions || {};
		this.dir = tmpOptions.LogDir || '.';
		this.log = tmpOptions.Log || null;
		this._runs = new Map();
		this._loadedRecent = false;
	}

	_runsDir()
	{
		return libPath.join(this.dir, '.monorepo-manager-runs');
	}

	createRun(pPlan, pOptions)
	{
		let tmpOptions = pOptions || {};
		let tmpHash = 'run-' + (pPlan.Type || 'bulk') + '-' + Date.now() + '-' + Math.floor(Math.random() * 9000 + 1000);

		let tmpRun =
			{
				RunHash: tmpHash,
				PlanId: pPlan.PlanId || null,
				Type: pPlan.Type || 'bulk',
				Label: tmpOptions.Label || pPlan.Label || (pPlan.Type || 'bulk'),
				Status: 'Queued',
				StartedAt: new Date().toISOString(),
				StoppedAt: null,
				Steps: (pPlan.Steps || []).map((pStep, pIndex) =>
					({
						Index: pIndex,
						Order: pStep.Order,
						Target: pStep.Target,
						Kind: pStep.Kind || 'flat',
						Status: 'Pending',
						StartedAt: null,
						StoppedAt: null,
						Actions: (pStep.Actions || []).map((pAction) => Object.assign({}, pAction, { Status: 'Pending', ExitCode: null, Error: null }))
					})),
				State: { Global: {}, Operation: {}, Tasks: {} },
				LogLines: [],
				Errors: [],
				Summary: {}
			};

		this._runs.set(tmpHash, tmpRun);
		this.checkpoint(tmpRun);
		return tmpRun;
	}

	checkpoint(pRun)
	{
		try
		{
			libFS.mkdirSync(this._runsDir(), { recursive: true });
			let tmpTemp = libPath.join(this._runsDir(), pRun.RunHash + '.json.tmp');
			let tmpDest = libPath.join(this._runsDir(), pRun.RunHash + '.json');
			libFS.writeFileSync(tmpTemp, JSON.stringify(pRun));
			libFS.renameSync(tmpTemp, tmpDest);
		}
		catch (pError)
		{
			if (this.log && this.log.warn) { this.log.warn('bulk manifest checkpoint failed: ' + pError.message); }
		}
	}

	get(pHash)
	{
		if (this._runs.has(pHash)) { return this._runs.get(pHash); }
		try
		{
			let tmpRun = JSON.parse(libFS.readFileSync(libPath.join(this._runsDir(), pHash + '.json'), 'utf8'));
			this._runs.set(pHash, tmpRun);
			return tmpRun;
		}
		catch (pError) { return null; }
	}

	_loadRecent()
	{
		if (this._loadedRecent) { return; }
		this._loadedRecent = true;
		try
		{
			let tmpFiles = libFS.readdirSync(this._runsDir()).filter((pFile) => (pFile.endsWith('.json')));
			for (let i = 0; i < tmpFiles.length; i++)
			{
				let tmpHash = tmpFiles[i].replace(/\.json$/, '');
				if (!this._runs.has(tmpHash))
				{
					try { this._runs.set(tmpHash, JSON.parse(libFS.readFileSync(libPath.join(this._runsDir(), tmpFiles[i]), 'utf8'))); }
					catch (pError) { /* skip corrupt */ }
				}
			}
		}
		catch (pError) { /* no runs dir yet */ }
	}

	list()
	{
		this._loadRecent();
		return Array.from(this._runs.values())
			.sort((pA, pB) => (String(pB.StartedAt || '').localeCompare(String(pA.StartedAt || ''))))
			.map((pRun) => (this.summary(pRun)));
	}

	summary(pRun)
	{
		let tmpSteps = pRun.Steps || [];
		return {
			RunHash: pRun.RunHash,
			Type: pRun.Type,
			Label: pRun.Label,
			Status: pRun.Status,
			StartedAt: pRun.StartedAt,
			StoppedAt: pRun.StoppedAt,
			StepCount: tmpSteps.length,
			Complete: tmpSteps.filter((pStep) => (pStep.Status === 'Complete')).length,
			Errors: tmpSteps.filter((pStep) => (pStep.Status === 'Error')).length
		};
	}
}

module.exports = BulkOperationManifest;
