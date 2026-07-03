const libPictView = require('pict-view');

function escapeHtml(pText)
{
	return String(pText === undefined || pText === null ? '' : pText).replace(/[&<>]/g, (pChar) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[pChar]));
}

function clockOf(pISO)
{
	if (!pISO) { return ''; }
	let tmpD = new Date(pISO);
	if (isNaN(tmpD.getTime())) { return ''; }
	let tmpP = (pN) => String(pN).padStart(2, '0');
	return tmpP(tmpD.getHours()) + ':' + tmpP(tmpD.getMinutes()) + ':' + tmpP(tmpD.getSeconds());
}

function stateClass(pState)
{
	if (pState === 'success') { return 'is-success'; }
	if (pState === 'error') { return 'is-error'; }
	if (pState === 'running') { return 'is-running'; }
	return 'is-idle';
}

/**
 * Manager-OutputPanel — the bottom log panel, with three tabs:
 *   - Output  : the live operation output (AppData.Manager.ActiveOperation) — streamed lines.
 *   - Actions : a session rollup of recent operations (AppData.Manager.ActionHistory, newest first),
 *               each a collapsible entry with its own output; the running one auto-expands.
 *   - Log     : the tail of the server operation log file (/api/manager/log), with a Refresh button.
 *
 * The WS provider re-renders this view on every op frame (live streaming). The panel record is mutated
 * in place in onBeforeRender (pict captures the record ref before onBeforeRender).
 */
class ManagerOutputPanelView extends libPictView
{
	constructor(pFable, pOptions, pServiceHash)
	{
		super(pFable, pOptions, pServiceHash);
		this._tab = 'output';       // 'output' | 'actions' | 'log'
		this._expanded = {};        // OperationId -> bool (Actions tab manual overrides)
		this._fileLog = null;       // cached /api/manager/log result
		this._loadingLog = false;
		this._renderedOnce = false;
	}

	onBeforeRender(pRenderable)
	{
		Object.assign(this.pict.AppData.Manager.OutputRecord, this._buildRecord());
		return super.onBeforeRender(pRenderable);
	}

	onAfterRender(pRenderable)
	{
		if (this._tab === 'output' || this._tab === 'log')
		{
			let tmpBody = document.getElementById('mm-output-body');
			if (tmpBody) { tmpBody.scrollTop = tmpBody.scrollHeight; }
		}
		this.pict.CSSMap.injectCSS();
		return super.onAfterRender(pRenderable);
	}

	_buildRecord()
	{
		let tmpManager = this.pict.AppData.Manager;
		let tmpOp = tmpManager.ActiveOperation || { HeaderText: 'idle', HeaderState: 'idle', Lines: [] };
		let tmpHistory = tmpManager.ActionHistory || [];
		let tmpTab = this._tab;

		return {
			OutputTabClass: tmpTab === 'output' ? 'is-active' : '',
			ActionsTabClass: tmpTab === 'actions' ? 'is-active' : '',
			LogTabClass: tmpTab === 'log' ? 'is-active' : '',
			ActionsBadgeSlot: tmpHistory.length ? [ { Text: String(tmpHistory.length) } ] : [],
			RunningDotSlot: (tmpOp.HeaderState === 'running') ? [ {} ] : [],
			CancelSlot: (tmpOp.HeaderState === 'running' && tmpOp.OperationId) ? [ { OperationId: tmpOp.OperationId } ] : [],
			RefreshSlot: tmpTab === 'log' ? [ {} ] : [],
			ExpandSlot: (tmpTab === 'actions' && tmpHistory.length) ? [ {} ] : [],
			BodyClass: 'tab-' + tmpTab,

			OutputSlot: tmpTab === 'output'
				? [ {
					HeaderText: tmpOp.HeaderText || 'idle',
					HeaderState: tmpOp.HeaderState || 'idle',
					Lines: (tmpOp.Lines || []).map((pL) => ({ Class: pL.Class || '', Text: escapeHtml(pL.Text) })),
					EmptySlot: (tmpOp.Lines || []).length === 0 ? [ {} ] : []
				} ]
				: [],
			ActionEntries: tmpTab === 'actions' ? tmpHistory.map((pH) => this._entryRecord(pH)) : [],
			ActionsEmptySlot: (tmpTab === 'actions' && tmpHistory.length === 0) ? [ {} ] : [],
			LogSlot: tmpTab === 'log' ? [ this._logRecord() ] : []
		};
	}

	_entryRecord(pHistory)
	{
		let tmpId = pHistory.OperationId;
		let tmpExpanded = (tmpId in this._expanded) ? this._expanded[tmpId] : (pHistory.State === 'running');
		return {
			OperationId: tmpId,
			OperationIdJs: String(tmpId).replace(/'/g, "\\'"),
			RootClass: stateClass(pHistory.State) + (tmpExpanded ? ' is-expanded' : ''),
			Label: pHistory.Label || tmpId,
			Meta: pHistory.ModuleName || '',
			Time: clockOf(pHistory.StartedAt),
			Lines: (pHistory.Lines || []).map((pL) => ({ Class: pL.Class || '', Text: escapeHtml(pL.Text) })),
			EmptySlot: (pHistory.Lines || []).length === 0 ? [ {} ] : []
		};
	}

	_logRecord()
	{
		if (this._loadingLog) { return { Message: 'loading…', TextSlot: [] }; }
		if (!this._fileLog) { return { Message: '(click Refresh to load the server log)', TextSlot: [] }; }
		if (!this._fileLog.Exists) { return { Message: '(no log file yet at ' + escapeHtml(this._fileLog.Path || '') + ')', TextSlot: [] }; }
		let tmpLines = this._fileLog.Lines || [];
		if (tmpLines.length === 0) { return { Message: '(log is empty)', TextSlot: [] }; }
		return { Message: '', TextSlot: [ { Text: tmpLines.map((pL) => escapeHtml(pL)).join('\n') } ] };
	}

	// ─── tab / entry / action handlers ───────────────────────────────
	switchTab(pTab)
	{
		if (pTab !== 'output' && pTab !== 'actions' && pTab !== 'log') { return; }
		this._tab = pTab;
		if (pTab === 'log' && !this._fileLog && !this._loadingLog) { this.reload(); return; }
		this.render();
	}

	toggleEntry(pOperationId)
	{
		let tmpCurrent = (pOperationId in this._expanded)
			? this._expanded[pOperationId]
			: this._isRunning(pOperationId);
		this._expanded[pOperationId] = !tmpCurrent;
		this.render();
	}

	_isRunning(pOperationId)
	{
		let tmpHistory = this.pict.AppData.Manager.ActionHistory || [];
		for (let i = 0; i < tmpHistory.length; i++)
		{
			if (tmpHistory[i].OperationId === pOperationId) { return tmpHistory[i].State === 'running'; }
		}
		return false;
	}

	expandAll()
	{
		let tmpHistory = this.pict.AppData.Manager.ActionHistory || [];
		tmpHistory.forEach((pH) => { this._expanded[pH.OperationId] = true; });
		this.render();
	}

	collapseAll()
	{
		let tmpHistory = this.pict.AppData.Manager.ActionHistory || [];
		tmpHistory.forEach((pH) => { this._expanded[pH.OperationId] = false; });
		this.render();
	}

	cancel(pOperationId)
	{
		let tmpAPI = this.pict.providers.ManagerAPI;
		if (tmpAPI) { tmpAPI.cancelOperation(pOperationId).catch(() => {}); }
	}

	reload()
	{
		let tmpAPI = this.pict.providers.ManagerAPI;
		if (!tmpAPI || typeof tmpAPI.fetchLog !== 'function') { return; }
		this._loadingLog = true;
		this.render();
		let tmpSelf = this;
		tmpAPI.fetchLog(500).then(
			(pResult) => { tmpSelf._fileLog = pResult || { Exists: false, Lines: [] }; tmpSelf._loadingLog = false; tmpSelf.render(); },
			() => { tmpSelf._fileLog = { Exists: false, Lines: [] }; tmpSelf._loadingLog = false; tmpSelf.render(); });
	}
}

ManagerOutputPanelView.default_configuration =
	{
		ViewIdentifier: 'Manager-OutputPanel',
		DefaultRenderable: 'Manager-OutputPanel-Content',
		DefaultDestinationAddress: '#RM-Output-Content',
		DefaultTemplateRecordAddress: 'AppData.Manager.OutputRecord',
		AutoRender: false,
		CSS: /*css*/`
			.mm-output { height: 100%; display: flex; flex-direction: column; background: var(--color-panel-alt); color: var(--color-text); }
			.mm-output-tabs
			{
				display: flex; align-items: center; gap: 4px; padding: 4px 10px; flex: 0 0 auto;
				border-bottom: 1px solid var(--color-border);
			}
			.mm-output-tab
			{
				display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px;
				background: transparent; color: var(--color-muted);
				border: 1px solid transparent; border-radius: var(--radius-sm);
				font-family: var(--font-mono); font-size: 11px; font-weight: 600;
				letter-spacing: 0.4px; text-transform: uppercase; cursor: pointer;
			}
			.mm-output-tab:hover { color: var(--color-text); }
			.mm-output-tab.is-active { color: var(--brand-color-primary-mode, var(--color-accent)); border-color: var(--color-border); background: var(--color-panel); }
			.mm-output-tab-badge
			{
				min-width: 14px; padding: 1px 4px; border-radius: 8px; text-align: center;
				background: var(--color-border); color: var(--color-text);
				font-size: 9px; text-transform: none; letter-spacing: 0; line-height: 1.2;
			}
			.mm-output-tab.is-active .mm-output-tab-badge { background: var(--brand-color-primary-mode, var(--color-accent)); color: var(--color-bg); }
			.mm-output-tab-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-warning); animation: mm-output-pulse 1.2s ease-in-out infinite; }
			@keyframes mm-output-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
			.mm-output-spacer { flex: 1 1 auto; }
			.mm-output-tool
			{
				padding: 2px 8px; font-family: var(--font-mono); font-size: 11px;
				background: transparent; color: var(--color-muted);
				border: 1px solid var(--color-border); border-radius: var(--radius-sm); cursor: pointer;
			}
			.mm-output-tool:hover { color: var(--brand-color-primary-mode, var(--color-accent)); border-color: var(--brand-color-primary-mode, var(--color-accent)); }

			.mm-output-body
			{
				flex: 1 1 auto; overflow: auto; padding: 8px 12px;
				background: var(--color-bg); color: var(--color-text);
				font-family: var(--font-mono); font-size: 11px; white-space: pre-wrap; line-height: 1.4;
			}
			.mm-output-body.tab-actions { padding: 0; white-space: normal; }
			.mm-output-head { color: var(--color-muted); margin-bottom: 4px; }
			.mm-output-body .cmd { color: var(--brand-color-primary-mode, var(--color-accent)); font-weight: 600; }
			.mm-output-body .meta { color: var(--color-muted); }
			.mm-output-body .err { color: var(--color-danger); }
			.mm-output-empty { color: var(--color-muted); font-style: italic; }

			/* Actions rollup */
			.mm-act { border-bottom: 1px solid var(--color-border); }
			.mm-act-head
			{
				display: flex; align-items: center; gap: 8px; width: 100%;
				padding: 6px 10px; border: 0; border-left: 3px solid transparent;
				background: transparent; color: var(--color-text);
				font-family: var(--font-mono); font-size: 12px; text-align: left; cursor: pointer;
			}
			.mm-act-head:hover { background: var(--color-panel-alt); }
			.mm-act.is-running  > .mm-act-head { border-left-color: var(--color-warning); }
			.mm-act.is-success  > .mm-act-head { border-left-color: var(--color-success); }
			.mm-act.is-error    > .mm-act-head { border-left-color: var(--color-danger); }
			.mm-act-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-muted); flex: 0 0 auto; }
			.mm-act.is-running .mm-act-dot { background: var(--color-warning); animation: mm-output-pulse 1.2s ease-in-out infinite; }
			.mm-act.is-success .mm-act-dot { background: var(--color-success); }
			.mm-act.is-error   .mm-act-dot { background: var(--color-danger); }
			.mm-act-time { color: var(--color-muted); font-variant-numeric: tabular-nums; flex: 0 0 auto; min-width: 56px; }
			.mm-act-label { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
			.mm-act-meta { margin-left: auto; color: var(--color-muted); flex: 0 0 auto; }
			.mm-act-body
			{
				margin: 0; padding: 6px 10px 10px 26px;
				background: var(--color-bg); color: var(--color-text);
				font-family: var(--font-mono); font-size: 11px; line-height: 1.4; white-space: pre-wrap;
			}
			.mm-act:not(.is-expanded) > .mm-act-body { display: none; }
			.mm-act-body .cmd { color: var(--brand-color-primary-mode, var(--color-accent)); font-weight: 600; }
			.mm-act-body .meta { color: var(--color-muted); }
			.mm-act-body .err { color: var(--color-danger); }
		`,
		Templates:
		[
			{
				Hash: 'Manager-OutputPanel-Content',
				Template: /*html*/`
<div class="mm-output">
	<div class="mm-output-tabs">
		<button class="mm-output-tab {~D:Record.OutputTabClass~}" onclick="_Pict.views['Manager-OutputPanel'].switchTab('output')">Output{~TS:Manager-OutputPanel-Dot:Record.RunningDotSlot~}</button>
		<button class="mm-output-tab {~D:Record.ActionsTabClass~}" onclick="_Pict.views['Manager-OutputPanel'].switchTab('actions')">Actions{~TS:Manager-OutputPanel-Badge:Record.ActionsBadgeSlot~}</button>
		<button class="mm-output-tab {~D:Record.LogTabClass~}" onclick="_Pict.views['Manager-OutputPanel'].switchTab('log')">Log</button>
		<span class="mm-output-spacer"></span>
		{~TS:Manager-OutputPanel-Expand:Record.ExpandSlot~}
		{~TS:Manager-OutputPanel-Refresh:Record.RefreshSlot~}
		{~TS:Manager-OutputPanel-Cancel:Record.CancelSlot~}
	</div>
	<div class="mm-output-body {~D:Record.BodyClass~}" id="mm-output-body">{~TS:Manager-OutputPanel-Output:Record.OutputSlot~}{~TS:Manager-OutputPanel-ActionsEmpty:Record.ActionsEmptySlot~}{~TS:Manager-OutputPanel-ActEntry:Record.ActionEntries~}{~TS:Manager-OutputPanel-Log:Record.LogSlot~}</div>
</div>`
			},
			{ Hash: 'Manager-OutputPanel-Dot', Template: /*html*/`<span class="mm-output-tab-dot" title="operation running"></span>` },
			{ Hash: 'Manager-OutputPanel-Badge', Template: /*html*/`<span class="mm-output-tab-badge">{~D:Record.Text~}</span>` },
			{ Hash: 'Manager-OutputPanel-Expand', Template: /*html*/`<button class="mm-output-tool" title="Expand all" onclick="_Pict.views['Manager-OutputPanel'].expandAll()">expand</button><button class="mm-output-tool" title="Collapse all" onclick="_Pict.views['Manager-OutputPanel'].collapseAll()">collapse</button>` },
			{ Hash: 'Manager-OutputPanel-Refresh', Template: /*html*/`<button class="mm-output-tool" title="Reload the server log tail" onclick="_Pict.views['Manager-OutputPanel'].reload()">refresh</button>` },
			{ Hash: 'Manager-OutputPanel-Cancel', Template: /*html*/`<button class="mm-output-tool" onclick="_Pict.views['Manager-OutputPanel'].cancel('{~D:Record.OperationId~}')">cancel</button>` },

			{
				Hash: 'Manager-OutputPanel-Output',
				Template: /*html*/`<div class="mm-output-head">{~D:Record.HeaderText~} · {~D:Record.HeaderState~}</div>{~TS:Manager-OutputPanel-OutEmpty:Record.EmptySlot~}{~TS:Manager-OutputPanel-Line:Record.Lines~}`
			},
			{ Hash: 'Manager-OutputPanel-OutEmpty', Template: /*html*/`<div class="mm-output-empty">no output yet</div>` },
			{ Hash: 'Manager-OutputPanel-Line', Template: /*html*/`<div class="{~D:Record.Class~}">{~D:Record.Text~}</div>` },

			{ Hash: 'Manager-OutputPanel-ActionsEmpty', Template: /*html*/`<div class="mm-output-empty" style="padding:16px">No actions yet — run one from a module workspace.</div>` },
			{
				Hash: 'Manager-OutputPanel-ActEntry',
				Template: /*html*/`
<div class="mm-act {~D:Record.RootClass~}">
	<button class="mm-act-head" onclick="_Pict.views['Manager-OutputPanel'].toggleEntry('{~D:Record.OperationIdJs~}')">
		<span class="mm-act-dot"></span>
		<span class="mm-act-time">{~D:Record.Time~}</span>
		<span class="mm-act-label">{~D:Record.Label~}</span>
		<span class="mm-act-meta">{~D:Record.Meta~}</span>
	</button>
	<div class="mm-act-body">{~TS:Manager-OutputPanel-ActEmpty:Record.EmptySlot~}{~TS:Manager-OutputPanel-Line:Record.Lines~}</div>
</div>`
			},
			{ Hash: 'Manager-OutputPanel-ActEmpty', Template: /*html*/`<div class="meta">(no output)</div>` },

			{ Hash: 'Manager-OutputPanel-Log', Template: /*html*/`<div class="mm-output-empty">{~D:Record.Message~}</div>{~TS:Manager-OutputPanel-LogText:Record.TextSlot~}` },
			{ Hash: 'Manager-OutputPanel-LogText', Template: /*html*/`{~D:Record.Text~}` }
		],
		Renderables:
		[
			{ RenderableHash: 'Manager-OutputPanel-Content', TemplateHash: 'Manager-OutputPanel-Content', ContentDestinationAddress: '#RM-Output-Content', RenderMethod: 'replace' }
		]
	};

module.exports = ManagerOutputPanelView;
