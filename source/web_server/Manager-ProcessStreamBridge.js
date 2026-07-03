/**
 * Manager-ProcessStreamBridge
 *
 * Subscribes to a core ProcessRunner's EventEmitter events and re-emits each as a WebSocket frame
 * via Manager-OperationBroadcaster. One bridge per ProcessRunner, alive for the server's lifetime.
 * Also caches recently-completed operation results so a client that missed a lifecycle frame can
 * poll GET /api/manager/operations/:id and learn the terminal state.
 */
class ProcessStreamBridge
{
	/**
	 * @param {ProcessRunner} pProcessRunner - Core EventEmitter runner.
	 * @param {ManagerOperationBroadcaster} pBroadcaster
	 * @param {object} [pOptions]
	 */
	constructor(pProcessRunner, pBroadcaster, pOptions)
	{
		this.processRunner = pProcessRunner;
		this.broadcaster = pBroadcaster;
		this.options = pOptions || {};

		this._meta = new Map();

		this._recentResults = new Map();
		this._recentResultsTtlMs = 5 * 60 * 1000;

		this._bindEvents();
	}

	getRecentResult(pOperationId)
	{
		let tmpEntry = this._recentResults.get(pOperationId);
		if (!tmpEntry) { return null; }
		if (Date.now() - tmpEntry.StoredAt > this._recentResultsTtlMs)
		{
			this._recentResults.delete(pOperationId);
			return null;
		}
		return tmpEntry.Result;
	}

	_rememberResult(pOperationId, pResult)
	{
		this._recentResults.set(pOperationId, { StoredAt: Date.now(), Result: pResult });
		if (this._recentResults.size > 64)
		{
			let tmpNow = Date.now();
			for (let tmpEntry of this._recentResults)
			{
				if (tmpNow - tmpEntry[1].StoredAt > this._recentResultsTtlMs)
				{
					this._recentResults.delete(tmpEntry[0]);
				}
			}
		}
	}

	_bindEvents()
	{
		let tmpSelf = this;

		this.processRunner.on('start', (pEvent) =>
			{
				tmpSelf._meta.set(pEvent.OperationId,
					{
						CommandString: pEvent.CommandString,
						Cwd: pEvent.Cwd,
						Label: pEvent.Label,
						StepIndex: pEvent.StepIndex,
						TotalSteps: pEvent.TotalSteps,
					});

				tmpSelf.broadcaster.broadcastStart(pEvent.OperationId,
					{
						CommandString: pEvent.CommandString,
						Cwd: pEvent.Cwd,
						Label: pEvent.Label || null,
						StartedAt: pEvent.StartedAt,
						StepIndex: pEvent.StepIndex,
						TotalSteps: pEvent.TotalSteps,
						IsFirstStep: pEvent.IsFirstStep,
					});
			});

		this.processRunner.on('line', (pEvent) =>
			{
				tmpSelf.broadcaster.broadcastStdout(pEvent.OperationId, pEvent.Channel, pEvent.Text);
			});

		this.processRunner.on('buffer-start', (pEvent) =>
			{
				tmpSelf.broadcaster.broadcastProgress(pEvent.OperationId,
					{
						Phase: 'buffering',
						Message: 'buffering remaining output (' + pEvent.LineCount + ' lines so far)',
					});
			});

		this.processRunner.on('buffer-tick', (pEvent) =>
			{
				tmpSelf.broadcaster.broadcastProgress(pEvent.OperationId,
					{
						Phase: 'buffering',
						Current: pEvent.LineCount,
						Message: pEvent.LineCount + ' lines buffered',
					});
			});

		this.processRunner.on('buffer-flush', (pEvent) =>
			{
				// No-op over WS — the browser already received every line via `stdout` frames.
			});

		this.processRunner.on('end', (pEvent) =>
			{
				if (!pEvent.IsLastStep)
				{
					tmpSelf.broadcaster.broadcastProgress(pEvent.OperationId,
						{
							Phase: 'step-complete',
							Current: pEvent.StepIndex + 1,
							Total: pEvent.TotalSteps,
							Message: 'step ' + (pEvent.StepIndex + 1) + ' / ' + pEvent.TotalSteps
								+ ' (' + pEvent.Duration + ', exit ' + pEvent.ExitCode + ')',
						});
					return;
				}

				let tmpCompletePayload =
					{
						ExitCode: pEvent.ExitCode,
						ElapsedMs: pEvent.ElapsedMs,
						Duration: pEvent.Duration,
						LineCount: pEvent.LineCount,
					};
				tmpSelf.broadcaster.broadcastComplete(pEvent.OperationId, tmpCompletePayload);
				tmpSelf._rememberResult(pEvent.OperationId,
					{
						Kind:      'complete',
						ExitCode:  pEvent.ExitCode,
						ElapsedMs: pEvent.ElapsedMs,
						Duration:  pEvent.Duration,
						LineCount: pEvent.LineCount,
						EndedAt:   new Date().toISOString(),
					});
				tmpSelf._meta.delete(pEvent.OperationId);
			});

		this.processRunner.on('error', (pEvent) =>
			{
				let tmpMessage = pEvent.Message || 'process error';
				tmpSelf.broadcaster.broadcastError(pEvent.OperationId, tmpMessage);
				tmpSelf._rememberResult(pEvent.OperationId,
					{
						Kind:    'error',
						Error:   tmpMessage,
						EndedAt: new Date().toISOString(),
					});
				tmpSelf._meta.delete(pEvent.OperationId);
			});
	}

	getMeta(pOperationId)
	{
		return this._meta.get(pOperationId) || null;
	}
}

module.exports = ProcessStreamBridge;
