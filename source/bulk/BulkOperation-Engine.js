/**
 * BulkOperation-Engine — the generic executor. Runs any Plan (produced by any planner) as ordered
 * steps across module targets: serial for ripple (order is the point), bounded-parallel for flat
 * bulk ops. Handles confirm gates (pause → resume), streamed output, retry-from-failed, and cancel.
 * Durable via BulkOperation-Manifest; emits lifecycle + output events to an optional broadcaster
 * (web) and/or an OnEvent callback (CLI).
 *
 * Constructed with injected deps (like the app's other core), not a fable-registered service, so the
 * same engine runs headless in the CLI and inside the web server.
 */
const libProcessRunner = require('../core/Manager-Core-ProcessRunner.js');
const libStateManager = require('./BulkOperation-StateManager.js');
const libStatus = require('./BulkOperation-Status.js');

class BulkOperationEngine
{
	/**
	 * @param {object} pOptions - { Loader, Introspector, Validator, Registry, Manifest,
	 *                              Broadcaster?, OnEvent?, DefaultConcurrency?, Log? }
	 */
	constructor(pOptions)
	{
		let tmpOptions = pOptions || {};
		this.log = tmpOptions.Log || (tmpOptions.Fable && tmpOptions.Fable.log) || console;
		this.loader = tmpOptions.Loader;
		this.introspector = tmpOptions.Introspector;
		this.validator = tmpOptions.Validator;
		this.registry = tmpOptions.Registry;
		this.manifest = tmpOptions.Manifest;
		this.broadcaster = tmpOptions.Broadcaster || null;
		this.onEvent = tmpOptions.OnEvent || null;
		this.defaultConcurrency = tmpOptions.DefaultConcurrency || 4;
		this._active = new Map();
	}

	hasActiveRun()
	{
		for (let tmpContext of this._active.values())
		{
			if (!libStatus.isTerminal(tmpContext.Run.Status)) { return true; }
		}
		return false;
	}

	_emit(pType, pPayload)
	{
		if (this.onEvent) { try { this.onEvent(pType, pPayload || {}); } catch (pError) { /* ignore */ } }
		if (this.broadcaster && typeof this.broadcaster.broadcast === 'function')
		{
			try { this.broadcaster.broadcast(Object.assign({ Type: 'bulk-' + pType }, pPayload || {})); } catch (pError) { /* ignore */ }
		}
	}

	// ─── run ─────────────────────────────────────────────────────
	run(pPlan, pRunOptions)
	{
		let tmpOptions = pRunOptions || {};
		if (this.hasActiveRun()) { throw new Error('A bulk operation is already running. Cancel it first.'); }

		let tmpRun = this.manifest.createRun(pPlan, tmpOptions);
		let tmpContext =
			{
				Run: tmpRun,
				Cancel: false,
				PendingConfirm: null,
				AutoConfirm: !!tmpOptions.AutoConfirm,
				Concurrency: tmpOptions.Concurrency || this.defaultConcurrency,
				Serial: (pPlan.Type === 'ripple') || !!tmpOptions.Serial,
				State: new libStateManager(tmpRun.State),
				Runner: null
			};
		this._active.set(tmpRun.RunHash, tmpContext);

		let tmpSelf = this;
		tmpContext.Done = this._execute(tmpContext).then(() => tmpRun).catch((pError) =>
			{
				tmpSelf._failRun(tmpContext, (pError && pError.message) || 'error');
				return tmpRun;
			});
		return { RunHash: tmpRun.RunHash, Run: tmpRun, Done: tmpContext.Done };
	}

	async _execute(pContext)
	{
		let tmpRun = pContext.Run;
		tmpRun.Status = libStatus.RUN_STATES.RUNNING;
		this.manifest.checkpoint(tmpRun);
		this._emit('run-start', { RunHash: tmpRun.RunHash, Type: tmpRun.Type, Label: tmpRun.Label, StepCount: tmpRun.Steps.length });

		if (pContext.Serial)
		{
			for (let i = 0; i < tmpRun.Steps.length; i++)
			{
				if (pContext.Cancel) { break; }
				await this._runStep(pContext, tmpRun.Steps[i]);
				if (tmpRun.Steps[i].Status === libStatus.STEP_STATES.ERROR) { break; } // halt cascade
			}
		}
		else
		{
			await this._runPool(pContext, tmpRun.Steps, pContext.Concurrency);
		}
		this._finalize(pContext);
	}

	async _runPool(pContext, pSteps, pConcurrency)
	{
		let tmpIndex = 0;
		let tmpSelf = this;
		async function worker()
		{
			while (tmpIndex < pSteps.length)
			{
				if (pContext.Cancel) { return; }
				let tmpStep = pSteps[tmpIndex++];
				await tmpSelf._runStep(pContext, tmpStep);
			}
		}
		let tmpWorkers = [];
		let tmpCount = Math.max(1, pConcurrency || 1);
		for (let i = 0; i < tmpCount; i++) { tmpWorkers.push(worker()); }
		await Promise.all(tmpWorkers);
	}

	async _runStep(pContext, pStep)
	{
		let tmpRun = pContext.Run;
		if (pStep.Status === libStatus.STEP_STATES.COMPLETE) { return; } // retry: already done

		if (pContext.Cancel) { pStep.Status = libStatus.STEP_STATES.SKIPPED; return; }
		pStep.Status = libStatus.STEP_STATES.RUNNING;
		pStep.StartedAt = new Date().toISOString();
		this.manifest.checkpoint(tmpRun);
		this._emit('step-start', { RunHash: tmpRun.RunHash, StepIndex: pStep.Index, Target: pStep.Target, Kind: pStep.Kind });

		let tmpError = null;
		for (let a = 0; a < pStep.Actions.length; a++)
		{
			let tmpAction = pStep.Actions[a];
			if (tmpAction.Status === libStatus.STEP_STATES.COMPLETE) { continue; } // retry: skip done actions
			if (pContext.Cancel) { tmpAction.Status = libStatus.STEP_STATES.SKIPPED; continue; }
			try
			{
				let tmpSkipped = await this._runAction(pContext, pStep, tmpAction, a);
				tmpAction.Status = tmpSkipped ? libStatus.STEP_STATES.SKIPPED : libStatus.STEP_STATES.COMPLETE;
			}
			catch (pActionError)
			{
				tmpAction.Status = libStatus.STEP_STATES.ERROR;
				tmpAction.Error = pActionError.message;
				tmpError = pActionError;
				tmpRun.Errors.push({ Target: pStep.Target, Op: tmpAction.Op, Message: pActionError.message });
				this._emit('action-end', { RunHash: tmpRun.RunHash, StepIndex: pStep.Index, ActionIndex: a, Op: tmpAction.Op, Status: 'Error', Error: pActionError.message });
				break;
			}
			this.manifest.checkpoint(tmpRun);
		}

		pStep.Status = tmpError ? libStatus.STEP_STATES.ERROR : libStatus.STEP_STATES.COMPLETE;
		pStep.StoppedAt = new Date().toISOString();
		this.manifest.checkpoint(tmpRun);
		this._emit('step-end', { RunHash: tmpRun.RunHash, StepIndex: pStep.Index, Target: pStep.Target, Status: pStep.Status });
	}

	async _runAction(pContext, pStep, pAction, pActionIndex)
	{
		let tmpRun = pContext.Run;
		let tmpTaskType = this.registry.get(pAction.Op);
		if (!tmpTaskType) { throw new Error('No task type registered for op: ' + pAction.Op); }

		pAction.Status = libStatus.STEP_STATES.RUNNING;
		this._emit('action-start', { RunHash: tmpRun.RunHash, StepIndex: pStep.Index, ActionIndex: pActionIndex, Op: pAction.Op, Target: pStep.Target });

		let tmpContext = this._taskContext(pContext, pStep, pAction, pActionIndex);

		let tmpRequiresConfirm = pAction.RequiresConfirm || (tmpTaskType.Definition && tmpTaskType.Definition.RequiresConfirm);
		if (tmpRequiresConfirm)
		{
			let tmpReport = null;
			let tmpValidator = tmpTaskType.Definition && tmpTaskType.Definition.Validator;
			if (tmpValidator) { tmpReport = await tmpValidator(tmpContext, pStep, pAction); }

			if (!pContext.AutoConfirm)
			{
				let tmpDecision = await this._confirmGate(pContext, pStep, pAction, pActionIndex, tmpReport);
				if (tmpDecision === 'skip') { this._emit('action-end', { RunHash: tmpRun.RunHash, StepIndex: pStep.Index, ActionIndex: pActionIndex, Op: pAction.Op, Status: 'Skipped' }); return true; }
			}
			else if (tmpReport && tmpReport.OkToPublish === false)
			{
				throw new Error('Pre-check failed: ' + ((tmpReport.Problems || []).map((pP) => (pP.Message)).join('; ') || 'not ok'));
			}
		}

		let tmpResult = (await tmpTaskType.Execute(tmpContext, pStep, pAction)) || {};
		if (tmpResult.Outputs)
		{
			let tmpScoped = pContext.State.forTarget(pStep.Target);
			Object.keys(tmpResult.Outputs).forEach((pKey) => tmpScoped.set(pKey, tmpResult.Outputs[pKey]));
		}
		if (tmpResult.StateWrites)
		{
			Object.keys(tmpResult.StateWrites).forEach((pAddr) => pContext.State.set(pAddr, tmpResult.StateWrites[pAddr]));
		}
		pAction.ExitCode = (tmpResult.ExitCode !== undefined) ? tmpResult.ExitCode : 0;
		this._emit('action-end', { RunHash: tmpRun.RunHash, StepIndex: pStep.Index, ActionIndex: pActionIndex, Op: pAction.Op, Status: tmpResult.Skip ? 'Skipped' : 'Complete' });
		return !!tmpResult.Skip;
	}

	_taskContext(pContext, pStep, pAction, pActionIndex)
	{
		let tmpSelf = this;
		let tmpRun = pContext.Run;
		return {
			Run: tmpRun,
			Target: pStep.Target,
			Module: this.loader ? this.loader.getModule(pStep.Target) : null,
			Loader: this.loader,
			Introspector: this.introspector,
			Validator: this.validator,
			State: pContext.State.forTarget(pStep.Target),
			GlobalState: pContext.State,
			RunHash: tmpRun.RunHash,
			StepIndex: pStep.Index,
			ActionIndex: pActionIndex,
			Log: (pLine, pClass) => tmpSelf._log(tmpRun, pStep, pLine, pClass),
			RunShell: (pShellOptions) => tmpSelf._runShell(pContext, tmpRun, pStep, pShellOptions)
		};
	}

	_log(pRun, pStep, pLine, pClass)
	{
		pRun.LogLines.push({ Target: pStep.Target, Text: pLine, Class: pClass || '' });
		if (pRun.LogLines.length > 5000) { pRun.LogLines.shift(); }
		this._emit('output', { RunHash: pRun.RunHash, StepIndex: pStep.Index, Target: pStep.Target, Channel: (pClass === 'err' ? 'stderr' : 'stdout'), Text: pLine });
	}

	_runShell(pContext, pRun, pStep, pShellOptions)
	{
		let tmpSelf = this;
		return new Promise((pResolve, pReject) =>
		{
			let tmpRunner = new libProcessRunner({});
			pContext.Runner = tmpRunner;
			tmpRunner.on('line', (pEvent) => tmpSelf._log(pRun, pStep, pEvent.Text, pEvent.Channel === 'stderr' ? 'err' : ''));
			tmpRunner.on('end', (pEvent) => { if ((pEvent.IsLastStep === false) && (pEvent.Aborted !== true)) { return; } pResolve(typeof pEvent.ExitCode === 'number' ? pEvent.ExitCode : 0); });
			tmpRunner.on('error', (pEvent) => pReject(new Error(pEvent.Message || 'command failed')));
			if (pShellOptions.Steps) { tmpRunner.runSequence({ Cwd: pShellOptions.Cwd, AbortOnError: pShellOptions.AbortOnError !== false, Steps: pShellOptions.Steps }); }
			else { tmpRunner.run({ Command: pShellOptions.Command, Args: pShellOptions.Args, Cwd: pShellOptions.Cwd, Label: pShellOptions.Label }); }
		});
	}

	// ─── confirm / cancel / retry ────────────────────────────────
	_confirmGate(pContext, pStep, pAction, pActionIndex, pReport)
	{
		let tmpSelf = this;
		let tmpRun = pContext.Run;
		return new Promise((pResolve) =>
		{
			tmpRun.Status = libStatus.RUN_STATES.WAITING;
			let tmpExpectedHash = (pReport && pReport.PreviewHash) || null;
			pContext.PendingConfirm = { StepIndex: pStep.Index, ActionIndex: pActionIndex, ExpectedHash: tmpExpectedHash, Resolve: pResolve };
			tmpSelf.manifest.checkpoint(tmpRun);
			tmpSelf._emit('paused',
				{
					RunHash: tmpRun.RunHash, StepIndex: pStep.Index, ActionIndex: pActionIndex, Target: pStep.Target, Op: pAction.Op,
					Report: pReport, PreviewHash: tmpExpectedHash,
					Prompt: pAction.ConfirmPrompt || ('Confirm ' + pAction.Op + ' on ' + pStep.Target + '?')
				});
		});
	}

	confirm(pRunHash, pOptions)
	{
		let tmpContext = this._active.get(pRunHash);
		if (!tmpContext || !tmpContext.PendingConfirm) { return { Ok: false, Error: 'NoPendingConfirm' }; }
		let tmpPending = tmpContext.PendingConfirm;
		let tmpOptions = pOptions || {};
		if (tmpOptions.StepIndex !== undefined && tmpOptions.StepIndex !== tmpPending.StepIndex) { return { Ok: false, Error: 'StepMismatch' }; }
		if (tmpPending.ExpectedHash && tmpOptions.PreviewHash !== tmpPending.ExpectedHash) { return { Ok: false, Error: 'PreviewStale' }; }
		tmpContext.PendingConfirm = null;
		tmpContext.Run.Status = libStatus.RUN_STATES.RUNNING;
		this.manifest.checkpoint(tmpContext.Run);
		tmpPending.Resolve(tmpOptions.Skip ? 'skip' : 'confirm');
		return { Ok: true };
	}

	cancel(pRunHash)
	{
		let tmpContext = this._active.get(pRunHash);
		if (!tmpContext) { return { Ok: false, Error: 'UnknownRun' }; }
		tmpContext.Cancel = true;
		if (tmpContext.PendingConfirm) { let tmpPending = tmpContext.PendingConfirm; tmpContext.PendingConfirm = null; tmpPending.Resolve('skip'); }
		if (tmpContext.Runner) { try { tmpContext.Runner.kill(); } catch (pError) { /* ignore */ } }
		return { Ok: true };
	}

	async retry(pRunHash)
	{
		let tmpRun = this.getRun(pRunHash);
		if (!tmpRun) { throw new Error('Unknown run'); }
		if (!libStatus.isTerminal(tmpRun.Status)) { throw new Error('Run is still active'); }

		let tmpFirstError = tmpRun.Steps.findIndex((pStep) => (pStep.Status === libStatus.STEP_STATES.ERROR));
		if (tmpFirstError < 0) { tmpFirstError = 0; }
		for (let i = tmpFirstError; i < tmpRun.Steps.length; i++)
		{
			let tmpStep = tmpRun.Steps[i];
			if (tmpStep.Status !== libStatus.STEP_STATES.COMPLETE)
			{
				tmpStep.Status = libStatus.STEP_STATES.PENDING;
				tmpStep.Actions.forEach((pAction) => { if (pAction.Status !== libStatus.STEP_STATES.COMPLETE) { pAction.Status = libStatus.STEP_STATES.PENDING; pAction.Error = null; } });
			}
		}
		tmpRun.Status = libStatus.RUN_STATES.RUNNING;
		tmpRun.Errors = [];

		let tmpContext =
			{
				Run: tmpRun, Cancel: false, PendingConfirm: null, AutoConfirm: true,
				Concurrency: this.defaultConcurrency, Serial: (tmpRun.Type === 'ripple'),
				State: new libStateManager(tmpRun.State), Runner: null
			};
		this._active.set(tmpRun.RunHash, tmpContext);

		let tmpSelf = this;
		let tmpToRun = tmpRun.Steps.filter((pStep) => (pStep.Status !== libStatus.STEP_STATES.COMPLETE));
		tmpContext.Done = (async () =>
			{
				tmpSelf._emit('run-start', { RunHash: tmpRun.RunHash, Retry: true, Type: tmpRun.Type });
				if (tmpContext.Serial)
				{
					for (let i = 0; i < tmpToRun.length; i++) { if (tmpContext.Cancel) { break; } await tmpSelf._runStep(tmpContext, tmpToRun[i]); if (tmpToRun[i].Status === libStatus.STEP_STATES.ERROR) { break; } }
				}
				else { await tmpSelf._runPool(tmpContext, tmpToRun, tmpContext.Concurrency); }
				tmpSelf._finalize(tmpContext);
				return tmpRun;
			})();
		return { RunHash: tmpRun.RunHash, Done: tmpContext.Done };
	}

	_failRun(pContext, pMessage)
	{
		let tmpRun = pContext.Run;
		tmpRun.Status = libStatus.RUN_STATES.FAILED;
		tmpRun.StoppedAt = new Date().toISOString();
		tmpRun.Errors.push({ Message: pMessage });
		this.manifest.checkpoint(tmpRun);
		this._emit('run-end', { RunHash: tmpRun.RunHash, Status: tmpRun.Status, Errors: tmpRun.Errors.length });
	}

	_finalize(pContext)
	{
		let tmpRun = pContext.Run;
		if (pContext.Cancel) { tmpRun.Status = libStatus.RUN_STATES.CANCELLED; }
		else if (tmpRun.Steps.some((pStep) => (pStep.Status === libStatus.STEP_STATES.ERROR))) { tmpRun.Status = libStatus.RUN_STATES.FAILED; }
		else { tmpRun.Status = libStatus.RUN_STATES.COMPLETE; }
		tmpRun.StoppedAt = new Date().toISOString();
		tmpRun.Summary = this.manifest.summary(tmpRun);
		this.manifest.checkpoint(tmpRun);
		this._emit('run-end', { RunHash: tmpRun.RunHash, Status: tmpRun.Status, Errors: tmpRun.Errors.length });
	}

	getRun(pRunHash)
	{
		let tmpContext = this._active.get(pRunHash);
		if (tmpContext) { return tmpContext.Run; }
		return this.manifest.get(pRunHash);
	}

	listRuns()
	{
		return this.manifest.list();
	}
}

module.exports = BulkOperationEngine;
