const libPictProvider = require('pict-provider');

const WS_PATH = '/ws/manager/operations';
const RECONNECT_DELAY_MS = 2500;
const ACTION_HISTORY_CAP = 12;

/**
 * Pict-Provider-Manager-OperationsWS — the live operation stream. Connects to the server's WS,
 * folds frames into AppData.Manager.ActiveOperation, and re-renders the output panel. Exposes
 * enqueueOperation() — the single chokepoint every action button routes through so only one op runs
 * at a time and its output surfaces in the bottom panel.
 */
class ManagerOperationsWSProvider extends libPictProvider
{
	constructor(pFable, pOptions, pServiceHash)
	{
		super(pFable, pOptions, pServiceHash);
		this._ws = null;
		this._reconnectTimer = null;
		this._opQueue = [];
	}

	connect()
	{
		let tmpProtocol = (typeof window !== 'undefined' && window.location.protocol === 'https:') ? 'wss:' : 'ws:';
		let tmpHost = (typeof window !== 'undefined') ? window.location.host : 'localhost';
		let tmpUrl = tmpProtocol + '//' + tmpHost + WS_PATH;

		let tmpSelf = this;
		let tmpSocket = new WebSocket(tmpUrl);
		this._ws = tmpSocket;

		tmpSocket.onopen = function () { if (tmpSelf._reconnectTimer) { clearTimeout(tmpSelf._reconnectTimer); tmpSelf._reconnectTimer = null; } };
		tmpSocket.onmessage = function (pEvent)
		{
			let tmpFrame;
			try { tmpFrame = JSON.parse(pEvent.data); }
			catch (pError) { return; }
			tmpSelf._handleFrame(tmpFrame);
		};
		tmpSocket.onclose = function ()
		{
			tmpSelf._ws = null;
			tmpSelf._reconnectTimer = setTimeout(function () { tmpSelf.connect(); }, RECONNECT_DELAY_MS);
		};
		tmpSocket.onerror = function () { /* onclose handles reconnect */ };
	}

	_op()
	{
		return this.pict.AppData.Manager.ActiveOperation;
	}

	_repaint()
	{
		let tmpView = this.pict.views['Manager-OutputPanel'];
		if (tmpView && typeof tmpView.render === 'function') { tmpView.render(); }
	}

	_pushLine(pClass, pText)
	{
		this._op().Lines.push({ Class: pClass || '', Text: pText });
	}

	_handleFrame(pFrame)
	{
		// Bulk-operation frames belong to the bulk provider.
		if (pFrame.Type && pFrame.Type.indexOf('bulk-') === 0)
		{
			let tmpBulk = this.pict.providers.ManagerBulk;
			if (tmpBulk && typeof tmpBulk.onFrame === 'function') { tmpBulk.onFrame(pFrame); }
			return;
		}

		let tmpOp = this._op();
		let tmpTerminal = false;

		switch (pFrame.Type)
		{
			case 'hello':
				return;
			case 'start':
				tmpOp.OperationId = pFrame.OperationId;
				tmpOp.HeaderState = 'running';
				tmpOp.HeaderText = pFrame.CommandString || pFrame.Label || pFrame.OperationId;
				this._pushLine('cmd', '$ ' + (pFrame.CommandString || ''));
				this._pushHistory(tmpOp, pFrame);
				break;
			case 'stdout':
				this._pushLine(pFrame.Channel === 'stderr' ? 'err' : '', pFrame.Text);
				break;
			case 'progress':
				if (pFrame.Message) { this._pushLine('meta', '· ' + pFrame.Message); }
				break;
			case 'complete':
				if (pFrame.ExitCode === 0) { tmpOp.HeaderState = 'success'; this._pushLine('meta', '✓ done (' + (pFrame.Duration || '') + ')'); }
				else { tmpOp.HeaderState = 'error'; this._pushLine('err', '✗ exit ' + pFrame.ExitCode); }
				tmpTerminal = true;
				break;
			case 'error':
				tmpOp.HeaderState = 'error';
				this._pushLine('err', '✗ ' + (pFrame.Error || 'error'));
				tmpTerminal = true;
				break;
			case 'cancelled':
				tmpOp.HeaderState = 'error';
				this._pushLine('err', '✗ cancelled');
				tmpTerminal = true;
				break;
			default:
				return;
		}

		this._repaint();

		if (tmpTerminal)
		{
			this._updateHistory(tmpOp.OperationId, tmpOp.HeaderState);
			// If a module op just finished and the user is still on that module, refresh its detail.
			let tmpWorkspace = this.pict.views['Manager-ModuleWorkspace'];
			if (tmpOp.ModuleName && tmpWorkspace && typeof tmpWorkspace.refreshDetail === 'function') { tmpWorkspace.refreshDetail(tmpOp.ModuleName); }
			// A status-changing op means the scan is stale — refresh it.
			let tmpAPI = this.pict.providers.ManagerAPI;
			if (tmpAPI && typeof tmpAPI.scanAllModules === 'function') { tmpAPI.scanAllModules().catch(() => {}); }
			this._pumpQueue();
		}
	}

	_pushHistory(pOp, pFrame)
	{
		let tmpHistory = this.pict.AppData.Manager.ActionHistory;
		// Same op re-starting (sequence step) → don't duplicate.
		if (tmpHistory.length > 0 && tmpHistory[0].OperationId === pFrame.OperationId) { return; }
		tmpHistory.unshift(
			{
				OperationId: pFrame.OperationId,
				Label: pOp.HeaderText,
				ModuleName: pOp.ModuleName || null,
				StartedAt: pFrame.StartedAt || new Date().toISOString(),
				State: 'running',
				Lines: pOp.Lines
			});
		while (tmpHistory.length > ACTION_HISTORY_CAP) { tmpHistory.pop(); }
	}

	_updateHistory(pOperationId, pState)
	{
		let tmpHistory = this.pict.AppData.Manager.ActionHistory;
		for (let i = 0; i < tmpHistory.length; i++)
		{
			if (tmpHistory[i].OperationId === pOperationId) { tmpHistory[i].State = pState; tmpHistory[i].EndedAt = new Date().toISOString(); break; }
		}
	}

	/**
	 * The chokepoint. pStartFn does the "press this button" work (stamp ActiveOperation, pop the
	 * output panel, call the API). If an op is running, queue it; else run now.
	 * @param {Function} pStartFn
	 * @param {object} pDescriptor - { Label, ModuleName? }
	 */
	enqueueOperation(pStartFn, pDescriptor)
	{
		let tmpOp = this._op();
		if (tmpOp.HeaderState === 'running')
		{
			this._opQueue.push({ Start: pStartFn, Descriptor: pDescriptor });
			this.pict.AppData.Manager.StatusMessage = 'Queued: ' + (pDescriptor && pDescriptor.Label || 'operation') + ' (' + this._opQueue.length + ' waiting)';
			let tmpStatus = this.pict.views['Manager-StatusBar']; if (tmpStatus) { tmpStatus.render(); }
			return;
		}
		pStartFn();
	}

	/**
	 * Reset ActiveOperation for a new op and surface the output panel. Called by pStartFn.
	 * @param {string} pLabel
	 * @param {string} [pModuleName]
	 */
	beginOperation(pLabel, pModuleName)
	{
		this.pict.AppData.Manager.ActiveOperation = { OperationId: null, Lines: [], HeaderState: 'running', HeaderText: pLabel, ModuleName: pModuleName || null };
		let tmpLayout = this.pict.views['Manager-Layout'];
		if (tmpLayout && typeof tmpLayout.popOutputPanel === 'function') { tmpLayout.popOutputPanel(); }
		this._repaint();
	}

	_pumpQueue()
	{
		if (this._opQueue.length === 0) { return; }
		let tmpNext = this._opQueue.shift();
		let tmpSelf = this;
		setTimeout(function () { tmpNext.Start(); }, 0);
	}
}

ManagerOperationsWSProvider.default_configuration =
	{
		ProviderIdentifier: 'ManagerOperationsWS',
		AutoInitialize: true,
		AutoInitializeOrdinal: 2
	};

module.exports = ManagerOperationsWSProvider;
