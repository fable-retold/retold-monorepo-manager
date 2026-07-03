const libPictProvider = require('pict-provider');

const API_BASE = '/api/manager';

/**
 * Pict-Provider-Manager-Bulk — REST + live-frame glue for the bulk-operation wizard. Loads the
 * catalog, plans (preview), runs, and drives confirm/cancel/retry. Live bulk-* WS frames are
 * forwarded here by the OperationsWS provider and folded into AppData.Manager.Bulk.Run.
 */
class ManagerBulkProvider extends libPictProvider
{
	async _get(pPath)
	{
		let tmpResponse = await fetch(API_BASE + pPath, { headers: { Accept: 'application/json' } });
		return tmpResponse.json();
	}

	async _post(pPath, pBody)
	{
		let tmpResponse = await fetch(API_BASE + pPath, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(pBody || {}) });
		let tmpText = await tmpResponse.text();
		let tmpBody;
		try { tmpBody = tmpText ? JSON.parse(tmpText) : {}; }
		catch (pError) { tmpBody = { Message: tmpText }; }
		if (!tmpResponse.ok) { let tmpError = new Error(tmpBody.Message || ('HTTP ' + tmpResponse.status)); tmpError.Info = tmpBody; throw tmpError; }
		return tmpBody;
	}

	_bulk() { return this.pict.AppData.Manager.Bulk; }
	_render() { let tmpView = this.pict.views['Manager-BulkWizard']; if (tmpView) { tmpView.render(); } }

	async loadCatalog()
	{
		let tmpResult = await this._get('/bulk/catalog');
		this._bulk().Catalog = tmpResult.Catalog || [];
		this._render();
	}

	async plan()
	{
		let tmpBulk = this._bulk();
		if (!tmpBulk.SelectedType) { return; }
		let tmpTargets = Object.keys(tmpBulk.SelectedTargets).filter((pName) => (tmpBulk.SelectedTargets[pName]));
		let tmpRequest = { Type: tmpBulk.SelectedType.Key, Targets: tmpTargets, Roots: tmpTargets, Params: tmpBulk.Params };
		try
		{
			tmpBulk.Plan = await this._post('/bulk/plan', tmpRequest);
			tmpBulk.PlanError = null;
			tmpBulk.Step = 'preview';
		}
		catch (pError) { tmpBulk.PlanError = pError.message; }
		this._render();
	}

	async run()
	{
		let tmpBulk = this._bulk();
		if (!tmpBulk.Plan) { return; }
		tmpBulk.Step = 'run';
		tmpBulk.Paused = null;
		tmpBulk.RunError = null;
		tmpBulk.Run =
			{
				Status: 'Running',
				Steps: tmpBulk.Plan.Steps.map((pStep) => ({ Index: pStep.Order, Target: pStep.Target, Kind: pStep.Kind, Status: 'Pending', Actions: pStep.Actions.map((pA) => ({ Op: pA.Op, Status: 'Pending' })) })),
				Log: []
			};
		this._render();
		try { let tmpResult = await this._post('/bulk/run', { Plan: tmpBulk.Plan }); tmpBulk.RunHash = tmpResult.RunHash; }
		catch (pError) { tmpBulk.RunError = pError.message; tmpBulk.Run.Status = 'Failed'; this._render(); }
	}

	async confirm(pSkip)
	{
		let tmpBulk = this._bulk();
		if (!tmpBulk.Paused || !tmpBulk.RunHash) { return; }
		try
		{
			await this._post('/bulk/' + tmpBulk.RunHash + '/confirm', { StepIndex: tmpBulk.Paused.StepIndex, PreviewHash: tmpBulk.Paused.PreviewHash, Skip: !!pSkip });
			tmpBulk.Paused = null;
			this._render();
		}
		catch (pError) { /* stale confirm; ignore */ }
	}

	async cancel()
	{
		let tmpBulk = this._bulk();
		if (tmpBulk.RunHash) { await this._post('/bulk/' + tmpBulk.RunHash + '/cancel', {}).catch(() => {}); }
	}

	async retry()
	{
		let tmpBulk = this._bulk();
		if (!tmpBulk.RunHash) { return; }
		// reset per-step display, keep completed
		if (tmpBulk.Run) { tmpBulk.Run.Status = 'Running'; }
		try { await this._post('/bulk/' + tmpBulk.RunHash + '/retry', {}); tmpBulk.Paused = null; this._render(); }
		catch (pError) { /* ignore */ }
	}

	onFrame(pFrame)
	{
		let tmpBulk = this._bulk();
		if (!tmpBulk) { return; }
		if (!tmpBulk.Run) { tmpBulk.Run = { Status: 'Running', Steps: [], Log: [] }; }
		let tmpRun = tmpBulk.Run;

		if (pFrame.Type === 'bulk-run-start') { tmpRun.Status = 'Running'; }
		else if (pFrame.Type === 'bulk-step-start') { let tmpStep = tmpRun.Steps[pFrame.StepIndex]; if (tmpStep) { tmpStep.Status = 'Running'; tmpStep.Target = pFrame.Target; } }
		else if (pFrame.Type === 'bulk-step-end') { let tmpStep = tmpRun.Steps[pFrame.StepIndex]; if (tmpStep) { tmpStep.Status = pFrame.Status; } }
		else if (pFrame.Type === 'bulk-action-start') { let tmpStep = tmpRun.Steps[pFrame.StepIndex]; if (tmpStep && tmpStep.Actions && tmpStep.Actions[pFrame.ActionIndex]) { tmpStep.Actions[pFrame.ActionIndex].Status = 'Running'; } }
		else if (pFrame.Type === 'bulk-action-end') { let tmpStep = tmpRun.Steps[pFrame.StepIndex]; if (tmpStep && tmpStep.Actions && tmpStep.Actions[pFrame.ActionIndex]) { tmpStep.Actions[pFrame.ActionIndex].Status = pFrame.Status; } }
		else if (pFrame.Type === 'bulk-output') { tmpRun.Log.push({ Target: pFrame.Target, Text: pFrame.Text, Channel: pFrame.Channel }); if (tmpRun.Log.length > 2000) { tmpRun.Log.shift(); } }
		else if (pFrame.Type === 'bulk-paused') { tmpBulk.Paused = { StepIndex: pFrame.StepIndex, Target: pFrame.Target, Op: pFrame.Op, Prompt: pFrame.Prompt, PreviewHash: pFrame.PreviewHash, Report: pFrame.Report }; tmpRun.Status = 'Waiting'; }
		else if (pFrame.Type === 'bulk-run-end') { tmpRun.Status = pFrame.Status; tmpBulk.Paused = null; }

		this._render();
	}
}

ManagerBulkProvider.default_configuration = { ProviderIdentifier: 'ManagerBulk', AutoInitialize: true, AutoInitializeOrdinal: 3 };

module.exports = ManagerBulkProvider;
