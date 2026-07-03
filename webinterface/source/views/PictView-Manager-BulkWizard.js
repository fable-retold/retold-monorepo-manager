const libPictView = require('pict-view');

function escapeHtml(pText)
{
	return String(pText === undefined || pText === null ? '' : pText).replace(/[&<>]/g, (pChar) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[pChar]));
}

/** A simple top-to-bottom dependency ladder for a ripple preview (producers at top). */
function buildGraphLadder(pPlan)
{
	if (!pPlan || pPlan.Type !== 'ripple' || !pPlan.Graph) { return ''; }
	let tmpOrder = pPlan.Steps.map((pStep) => (pStep.Target));
	if (tmpOrder.length === 0 || tmpOrder.length > 40) { return '<div class="mm-muted">' + tmpOrder.length + ' modules — see the step list.</div>'; }
	let tmpIndex = {};
	tmpOrder.forEach((pName, pI) => { tmpIndex[pName] = pI; });
	let tmpRoots = pPlan.Roots || [];
	let tmpEdges = (pPlan.Graph.Edges) || [];
	let tmpRowH = 26;
	let tmpWidth = 360;
	let tmpHeight = tmpOrder.length * tmpRowH + 12;
	let tmpSvg = '<svg width="' + tmpWidth + '" height="' + tmpHeight + '" xmlns="http://www.w3.org/2000/svg">';
	for (let i = 0; i < tmpEdges.length; i++)
	{
		let tmpFrom = tmpIndex[tmpEdges[i].From];
		let tmpTo = tmpIndex[tmpEdges[i].To];
		if (tmpFrom === undefined || tmpTo === undefined) { continue; }
		let tmpY1 = tmpTo * tmpRowH + tmpRowH / 2 + 6;
		let tmpY2 = tmpFrom * tmpRowH + tmpRowH / 2 + 6;
		tmpSvg += '<path d="M 120 ' + tmpY1 + ' C 60 ' + tmpY1 + ', 60 ' + tmpY2 + ', 120 ' + tmpY2 + '" fill="none" stroke="var(--color-border, #4d5866)" stroke-width="1.2"/>';
	}
	tmpOrder.forEach((pName, pI) =>
		{
			let tmpY = pI * tmpRowH + tmpRowH / 2 + 6;
			let tmpIsRoot = tmpRoots.indexOf(pName) >= 0;
			tmpSvg += '<circle cx="120" cy="' + tmpY + '" r="4.5" fill="' + (tmpIsRoot ? 'var(--brand-color-secondary, #e07e40)' : 'var(--brand-color-primary, #2f97b4)') + '"/>';
			tmpSvg += '<text x="134" y="' + (tmpY + 4) + '" font-size="12" fill="var(--color-text, #e6edf3)">' + escapeHtml(pName) + '</text>';
		});
	tmpSvg += '</svg>';
	return tmpSvg;
}

function formatReport(pReport)
{
	if (!pReport) { return ''; }
	let tmpProblems = (pReport.Problems || []).map((pP) => (pP.Message)).join('; ');
	return 'local ' + (pReport.LocalVersion || '?') + ' / npm ' + (pReport.PublishedVersion || '(unpublished)') + (tmpProblems ? ' — ' + tmpProblems : '');
}

class ManagerBulkWizardView extends libPictView
{
	onBeforeRender(pRenderable)
	{
		let tmpBulk = this.pict.AppData.Manager.Bulk;
		let tmpRecord = this.pict.AppData.Manager.BulkRecord;
		let tmpStep = tmpBulk.Step || 'choose';
		let tmpType = tmpBulk.SelectedType;

		let tmpCatalog = (tmpBulk.Catalog || []).map((pEntry) =>
			({ Key: pEntry.Key, Label: pEntry.Label, Description: pEntry.Description || '', SelClass: (tmpType && tmpType.Key === pEntry.Key) ? 'mm-opcard-selected' : '' }));

		let tmpNeedsTargets = tmpType && (tmpType.TargetMode === 'selected' || tmpType.TargetMode === 'roots');
		let tmpModules = (this.pict.AppData.Manager.Modules || []).map((pModule) =>
			({ Name: pModule.Name, Checked: tmpBulk.SelectedTargets[pModule.Name] ? 'checked' : '' }));

		let tmpChooseDetail = tmpType ? [ {
			Label: tmpType.Label,
			TargetHint: tmpNeedsTargets ? (tmpType.TargetMode === 'roots' ? 'Pick the root module(s) to publish; every dependent cascades automatically.' : 'Select the module(s) to run on.')
				: (tmpType.TargetMode === 'all' ? 'Runs on every module.' : 'Runs once across the whole repo.'),
			Modules: tmpNeedsTargets ? tmpModules : [],
			KindSlot: (tmpType.Params && tmpType.Params.indexOf('Kind') >= 0) ? [ { } ] : []
		} ] : [];

		let tmpPlan = tmpBulk.Plan;
		let tmpPreviewSteps = tmpPlan ? tmpPlan.Steps.map((pStep) =>
			({ N: pStep.Order + 1, Target: pStep.Target, Kind: pStep.Kind, Ops: pStep.Actions.map((pA) => (pA.Op)).join(' · '), HasConfirm: pStep.Actions.some((pA) => (pA.RequiresConfirm)) ? [ {} ] : [] })) : [];

		let tmpRun = tmpBulk.Run;
		let tmpRunSteps = tmpRun ? tmpRun.Steps.map((pStep) =>
			({ Target: pStep.Target, Kind: pStep.Kind, Status: pStep.Status, StatusClass: 'mm-pill-' + String(pStep.Status || 'pending').toLowerCase(),
				Ops: (pStep.Actions || []).map((pA) => ({ Op: pA.Op, C: 'mm-a-' + String(pA.Status || 'pending').toLowerCase() })) })) : [];
		let tmpRunLog = tmpRun ? tmpRun.Log.slice(-250).map((pL) => ({ Text: escapeHtml((pL.Target ? '[' + pL.Target + '] ' : '') + pL.Text), C: pL.Channel === 'stderr' ? 'err' : '' })) : [];
		let tmpDone = tmpRun && [ 'Complete', 'Failed', 'Cancelled' ].indexOf(tmpRun.Status) >= 0;

		Object.assign(tmpRecord,
			{
				Catalog: tmpCatalog,
				ChooseDetail: tmpChooseDetail,
				PlanErrorSlot: tmpBulk.PlanError ? [ { Text: tmpBulk.PlanError } ] : [],
				RunErrorSlot: tmpBulk.RunError ? [ { Text: tmpBulk.RunError } ] : [],
				PreviewLabel: tmpPlan ? tmpPlan.Label : '',
				PreviewStepCount: tmpPlan ? tmpPlan.Steps.length : 0,
				PreviewSteps: tmpPreviewSteps,
				GraphSvg: buildGraphLadder(tmpPlan),
				RippleNote: (tmpPlan && tmpPlan.Type === 'ripple') ? [ {} ] : [],
				RunLabel: tmpPlan ? tmpPlan.Label : (tmpBulk.SelectedType ? tmpBulk.SelectedType.Label : 'Operation'),
				RunStatus: tmpRun ? tmpRun.Status : '',
				RunStatusClass: 'mm-pill-' + String(tmpRun ? tmpRun.Status : '').toLowerCase(),
				Complete: tmpRun ? tmpRun.Steps.filter((pS) => (pS.Status === 'Complete')).length : 0,
				Errors: tmpRun ? tmpRun.Steps.filter((pS) => (pS.Status === 'Error')).length : 0,
				StepTotal: tmpRun ? tmpRun.Steps.length : 0,
				RunSteps: tmpRunSteps,
				RunLog: tmpRunLog,
				PausedSlot: tmpBulk.Paused ? [ { Prompt: tmpBulk.Paused.Prompt, ReportText: formatReport(tmpBulk.Paused.Report) } ] : [],
				RunActiveSlot: (tmpRun && !tmpDone) ? [ {} ] : [],
				RunDoneSlot: tmpDone ? [ { FailedSlot: (tmpRun.Status === 'Failed') ? [ {} ] : [] } ] : [],
				RunError: tmpBulk.RunError || ''
			});

		pRenderable.TemplateHash = (tmpStep === 'preview') ? 'Manager-BulkWizard-Preview' : (tmpStep === 'run') ? 'Manager-BulkWizard-Run' : 'Manager-BulkWizard-Choose';
		return super.onBeforeRender(pRenderable);
	}

	onAfterRender(pRenderable)
	{
		let tmpBody = document.getElementById('mm-bulk-log');
		if (tmpBody) { tmpBody.scrollTop = tmpBody.scrollHeight; }
		this.pict.CSSMap.injectCSS();
		return super.onAfterRender(pRenderable);
	}

	// ─── choose ───
	chooseType(pKey)
	{
		let tmpBulk = this.pict.AppData.Manager.Bulk;
		let tmpEntry = (tmpBulk.Catalog || []).find((pE) => (pE.Key === pKey));
		tmpBulk.SelectedType = tmpEntry || null;
		tmpBulk.TargetMode = tmpEntry ? tmpEntry.TargetMode : 'all';
		tmpBulk.SelectedTargets = {};
		tmpBulk.Params = {};
		tmpBulk.PlanError = null;
		this.render();
	}

	toggleTarget(pName, pChecked) { this.pict.AppData.Manager.Bulk.SelectedTargets[pName] = pChecked; }
	setKind(pKind) { this.pict.AppData.Manager.Bulk.Params.Kind = pKind; }

	preview() { this.pict.providers.ManagerBulk.plan(); }
	back() { this.pict.AppData.Manager.Bulk.Step = 'choose'; this.render(); }
	run() { this.pict.providers.ManagerBulk.run(); }
	confirm(pSkip) { this.pict.providers.ManagerBulk.confirm(pSkip); }
	cancel() { this.pict.providers.ManagerBulk.cancel(); }
	retry() { this.pict.providers.ManagerBulk.retry(); }

	reset()
	{
		let tmpBulk = this.pict.AppData.Manager.Bulk;
		tmpBulk.Step = 'choose'; tmpBulk.Plan = null; tmpBulk.Run = null; tmpBulk.Paused = null; tmpBulk.RunHash = null; tmpBulk.PlanError = null; tmpBulk.RunError = null;
		this.render();
	}
}

ManagerBulkWizardView.default_configuration =
	{
		ViewIdentifier: 'Manager-BulkWizard',
		DefaultRenderable: 'Manager-BulkWizard-Renderable',
		DefaultTemplateRecordAddress: 'AppData.Manager.BulkRecord',
		DefaultDestinationAddress: '#RM-Workspace-Content',
		AutoRender: false,
		CSS: /*css*/`
			.mm-oplist { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; margin: 14px 0; }
			.mm-opcard { border-radius: 8px; padding: 10px 12px; cursor: pointer; }
			.mm-opcard-label { font-weight: 600; }
			.mm-opcard-desc { font-size: 12px; margin-top: 3px; }
			.mm-choose-detail { margin-top: 8px; padding-top: 12px; }
			.mm-modulecheck { display: flex; flex-wrap: wrap; gap: 4px 16px; max-height: 240px; overflow: auto; margin: 8px 0; }
			.mm-check { font-size: 13px; display: inline-flex; align-items: center; gap: 5px; }
			.mm-preview { display: flex; gap: 24px; margin: 12px 0; }
			.mm-preview-graph { flex: none; }
			.mm-preview-steps { flex: 1; }
			.mm-prevstep { padding: 3px 0; font-size: 13px; }
			.mm-badge-confirm { font-size: 10px; text-transform: uppercase; letter-spacing: .4px; border-radius: 4px; padding: 1px 5px; margin-left: 4px; }
			.mm-runsteps { margin: 12px 0; }
			.mm-runstep { padding: 4px 0; font-size: 13px; }
			.mm-pill { font-size: 11px; border-radius: 10px; padding: 1px 8px; }
			.mm-gate { border-radius: 8px; padding: 12px 14px; margin: 12px 0; }
		`,
		Templates:
		[
			{
				Hash: 'Manager-BulkWizard-Choose',
				Template: /*html*/`
<div class="mm-workspace">
	<h2>Bulk operations</h2>
	<p class="mm-sub">Step 1 of 3 — choose what to do.</p>
	<div class="mm-oplist">{~TS:Manager-BulkWizard-OpCard:Record.Catalog~}</div>
	{~TS:Manager-BulkWizard-ChooseDetail:Record.ChooseDetail~}
	{~TS:Manager-BulkWizard-ErrorLine:Record.PlanErrorSlot~}
</div>`
			},
			{ Hash: 'Manager-BulkWizard-OpCard', Template: /*html*/`<div class="mm-opcard {~D:Record.SelClass~}" onclick="_Pict.views['Manager-BulkWizard'].chooseType('{~D:Record.Key~}')"><div class="mm-opcard-label">{~D:Record.Label~}</div><div class="mm-opcard-desc">{~D:Record.Description~}</div></div>` },
			{
				Hash: 'Manager-BulkWizard-ChooseDetail',
				Template: /*html*/`
<div class="mm-choose-detail">
	<h3>{~D:Record.Label~}</h3>
	<p class="mm-sub">{~D:Record.TargetHint~}</p>
	{~TS:Manager-BulkWizard-KindPicker:Record.KindSlot~}
	<div class="mm-modulecheck">{~TS:Manager-BulkWizard-TargetRow:Record.Modules~}</div>
	<div class="mm-actions"><button class="mm-btn mm-btn-primary" onclick="_Pict.views['Manager-BulkWizard'].preview()">Preview →</button></div>
</div>`
			},
			{ Hash: 'Manager-BulkWizard-KindPicker', Template: /*html*/`<p>Bump: <select onchange="_Pict.views['Manager-BulkWizard'].setKind(this.value)"><option value="patch">patch</option><option value="minor">minor</option><option value="major">major</option></select></p>` },
			{ Hash: 'Manager-BulkWizard-TargetRow', Template: /*html*/`<label class="mm-check"><input type="checkbox" {~D:Record.Checked~} onchange="_Pict.views['Manager-BulkWizard'].toggleTarget('{~D:Record.Name~}', this.checked)">{~D:Record.Name~}</label>` },

			{
				Hash: 'Manager-BulkWizard-Preview',
				Template: /*html*/`
<div class="mm-workspace">
	<h2>{~D:Record.PreviewLabel~}</h2>
	<p class="mm-sub">Step 2 of 3 — preview. Nothing runs yet. {~D:Record.PreviewStepCount~} step(s).{~TS:Manager-BulkWizard-RippleNote:Record.RippleNote~}</p>
	<div class="mm-preview">
		<div class="mm-preview-graph">{~D:Record.GraphSvg~}</div>
		<div class="mm-preview-steps">{~TS:Manager-BulkWizard-PreviewStep:Record.PreviewSteps~}</div>
	</div>
	<div class="mm-actions">
		<button class="mm-btn" onclick="_Pict.views['Manager-BulkWizard'].back()">← Back</button>
		<button class="mm-btn mm-btn-primary" onclick="_Pict.views['Manager-BulkWizard'].run()">Run →</button>
	</div>
</div>`
			},
			{ Hash: 'Manager-BulkWizard-RippleNote', Template: /*html*/` Producers first, then every dependent — publishes are confirmed one at a time.` },
			{ Hash: 'Manager-BulkWizard-PreviewStep', Template: /*html*/`<div class="mm-prevstep"><b>{~D:Record.N~}.</b> {~D:Record.Target~} <span class="mm-muted">[{~D:Record.Kind~}]</span> → {~D:Record.Ops~}{~TS:Manager-BulkWizard-ConfirmBadge:Record.HasConfirm~}</div>` },
			{ Hash: 'Manager-BulkWizard-ConfirmBadge', Template: /*html*/`<span class="mm-badge-confirm">confirm</span>` },

			{
				Hash: 'Manager-BulkWizard-Run',
				Template: /*html*/`
<div class="mm-workspace">
	<h2>{~D:Record.RunLabel~}</h2>
	<p class="mm-sub">Step 3 of 3 — <span class="mm-pill {~D:Record.RunStatusClass~}">{~D:Record.RunStatus~}</span> · {~D:Record.Complete~}/{~D:Record.StepTotal~} complete · {~D:Record.Errors~} error(s)</p>
	{~TS:Manager-BulkWizard-Gate:Record.PausedSlot~}
	<div class="mm-runsteps">{~TS:Manager-BulkWizard-RunStep:Record.RunSteps~}</div>
	<div class="mm-output" style="height:170px;border-radius:8px"><div class="mm-output-body" id="mm-bulk-log">{~TS:Manager-BulkWizard-LogLine:Record.RunLog~}</div></div>
	<div class="mm-actions">
		{~TS:Manager-BulkWizard-CancelBtn:Record.RunActiveSlot~}
		{~TS:Manager-BulkWizard-DoneControls:Record.RunDoneSlot~}
	</div>
	{~TS:Manager-BulkWizard-ErrorLine:Record.RunErrorSlot~}
</div>`
			},
			{ Hash: 'Manager-BulkWizard-ErrorLine', Template: /*html*/`<p style="color:var(--color-danger, #d1594a)">{~D:Record.Text~}</p>` },
			{ Hash: 'Manager-BulkWizard-Gate', Template: /*html*/`<div class="mm-gate"><b>{~D:Record.Prompt~}</b><div class="mm-muted">{~D:Record.ReportText~}</div><div class="mm-actions"><button class="mm-btn mm-btn-primary" onclick="_Pict.views['Manager-BulkWizard'].confirm(false)">Confirm</button><button class="mm-btn" onclick="_Pict.views['Manager-BulkWizard'].confirm(true)">Skip</button></div></div>` },
			{ Hash: 'Manager-BulkWizard-RunStep', Template: /*html*/`<div class="mm-runstep"><span class="mm-pill {~D:Record.StatusClass~}">{~D:Record.Status~}</span> <b>{~D:Record.Target~}</b> <span class="mm-muted">{~TS:Manager-BulkWizard-RunOp:Record.Ops~}</span></div>` },
			{ Hash: 'Manager-BulkWizard-RunOp', Template: /*html*/`<span class="{~D:Record.C~}">{~D:Record.Op~}</span> ` },
			{ Hash: 'Manager-BulkWizard-LogLine', Template: /*html*/`<div class="{~D:Record.C~}">{~D:Record.Text~}</div>` },
			{ Hash: 'Manager-BulkWizard-CancelBtn', Template: /*html*/`<button class="mm-btn" onclick="_Pict.views['Manager-BulkWizard'].cancel()">Cancel</button>` },
			{ Hash: 'Manager-BulkWizard-DoneControls', Template: /*html*/`<button class="mm-btn mm-btn-primary" onclick="_Pict.views['Manager-BulkWizard'].reset()">New operation</button>{~TS:Manager-BulkWizard-RetryBtn:Record.FailedSlot~}` },
			{ Hash: 'Manager-BulkWizard-RetryBtn', Template: /*html*/`<button class="mm-btn" onclick="_Pict.views['Manager-BulkWizard'].retry()">Retry failed</button>` }
		],
		Renderables:
		[
			{ RenderableHash: 'Manager-BulkWizard-Renderable', TemplateHash: 'Manager-BulkWizard-Choose', ContentDestinationAddress: '#RM-Workspace-Content', RenderMethod: 'replace' }
		]
	};

module.exports = ManagerBulkWizardView;
