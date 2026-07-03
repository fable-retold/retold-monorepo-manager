'use strict';

const libChildProcess = require('child_process');
const libFs           = require('fs');
const libNet          = require('net');
const libPath         = require('path');

/**
 * Retold Monorepo Manager -- Service Supervisor (core)
 *
 * A single, generic, config-driven supervisor that manages a REGISTRY of
 * named long-running dev servers (docserve, content-editor, examples,
 * or anything else the caller registers).  It is the generalization of
 * retold-manager's three near-identical supervisors
 * (Docserve / ContentEditor / Examples): each of those spawned ONE
 * long-running child on a fixed port, polled the port for readiness,
 * tracked a single-active lifecycle, distinguished a self-kill from a
 * crash, and cleaned up on manager exit.  All three behaviours are
 * preserved here — the only things that were hardcoded (the command,
 * the port, and the optional `npm install` pre-step) now come from a
 * plain service-definition config object rather than being baked into
 * the class.
 *
 * There is at most ONE live child per service key at a time.  Starting a
 * service that is already running kills the in-flight child first
 * (idempotent when nothing is running), exactly like the originals'
 * `start()` calling `stop()` up front.
 *
 * SERVICE DEFINITION SHAPE (a plain object, registered by key):
 *
 *   {
 *     Name:               'Docserve',            // human label, used in logs
 *     Port:               43210,                 // fixed port to poll / build the URL from
 *
 *     // --- command: EITHER a single Command string (tokens allowed) ...
 *     Command:            'node {cliPath} serve {docsPath} -p {Port}',
 *     // --- OR an explicit Runnable + Args[] (tokens allowed in either) ---
 *     Runnable:           'node',
 *     Args:               [ '{cliPath}', 'serve', '{docsPath}', '-p', '{Port}' ],
 *
 *     Cwd:                '{modulePath}',        // working dir (tokens allowed)
 *     ReadyTimeoutMs:     8000,                  // port-poll deadline (default 8000)
 *
 *     // --- optional two-phase install -> serve, as ExamplesSupervisor did ---
 *     InstallFirst:       true,                  // run `npm install` in Cwd when node_modules/ is absent
 *     // ... or a fully general ordered pre-step list (each Step is a
 *     //     { Runnable, Args[], Cwd? } like the main command; the LAST
 *     //     Step is the long-running server, everything before it must
 *     //     exit 0 before the next runs):
 *     Steps:
 *     [
 *       { Runnable: 'npm', Args: [ 'install' ], SkipIfExists: 'node_modules' },
 *       { Runnable: 'npx', Args: [ 'quack', 'examples', '-p', '{Port}' ] }
 *     ]
 *   }
 *
 * PLACEHOLDER RULES:
 *   - `{token}` substrings in Command / Runnable / Args / Cwd / Steps are
 *     replaced at start() time from a merged params object.  The merge
 *     order (later wins) is: the service definition's own scalar fields
 *     (so `{Port}` / `{Name}` resolve from the definition) then the
 *     pParams passed to start() (so callers supply `{docsPath}`,
 *     `{modulePath}`, `{cliPath}`, …).
 *   - An unresolved `{token}` (no matching param) is a hard error at
 *     start() — we throw before spawning rather than launching a child
 *     with a literal `{token}` in its argv.
 *
 * PRE-STEP MECHANISM (two ways, matching the originals):
 *   - `InstallFirst: true` is the ExamplesSupervisor shorthand: when the
 *     service's Cwd has no node_modules/, run `npm install` there first
 *     and only spawn the server on a clean (exit-0) install.  If
 *     node_modules/ already exists the install is skipped.
 *   - `Steps: [...]` is the general form: an ordered list where every
 *     entry but the last is a blocking pre-step (must exit 0) and the
 *     final entry is the long-running server that gets the port poll.
 *     A step may carry `SkipIfExists: '<relpath>'` to skip itself when
 *     that path already exists under its Cwd (how InstallFirst is
 *     expressed internally).
 *
 * Fable/pict are NOT required — this is a plain class constructed with
 * `{ log }`, matching the originals.
 */

const READY_TIMEOUT_DEFAULT_MS = 8000;
const READY_POLL_INTERVAL_MS   = 200;

// Poll TCP connect against 127.0.0.1:<port> every ~200ms until the
// listener is up (success) or the deadline passes (timeout).  Used after
// spawning a server child to defer "the service is ready" until it has
// actually bound the port — without this, the first open of the URL
// races the child's HTTP-server boot and shows a "could not connect"
// error page.  This is verbatim the originals' _waitForPort.
function _waitForPort(pPort, pTimeoutMs, pCallback)
{
	let tmpStart    = Date.now();
	let tmpInterval = READY_POLL_INTERVAL_MS;
	let tmpDone     = false;
	let finish = (pError) =>
		{
			if (tmpDone) { return; }
			tmpDone = true;
			pCallback(pError || null);
		};
	let tryOnce = () =>
		{
			let tmpSocket = libNet.createConnection({ host: '127.0.0.1', port: pPort });
			let tmpSettled = false;
			let settle = (pError) =>
				{
					if (tmpSettled) { return; }
					tmpSettled = true;
					try { tmpSocket.destroy(); } catch (e) { /* already closed */ }
					if (!pError) { return finish(null); }
					if (Date.now() - tmpStart >= pTimeoutMs)
					{
						return finish(new Error('Port ' + pPort + ' did not open within ' + pTimeoutMs + 'ms'));
					}
					setTimeout(tryOnce, tmpInterval);
				};
			tmpSocket.once('connect', () => settle(null));
			tmpSocket.once('error',   (pError) => settle(pError));
			tmpSocket.setTimeout(500, () => settle(new Error('connect timeout')));
		};
	tryOnce();
}

// Replace every {token} in a string from pParams.  Throws on an
// unresolved token so we never spawn a child carrying a literal
// `{placeholder}` in its argv.
function _substituteString(pValue, pParams, pContextLabel)
{
	return String(pValue).replace(/\{([^{}]+)\}/g, (pMatch, pToken) =>
		{
			if (Object.prototype.hasOwnProperty.call(pParams, pToken) && (pParams[pToken] !== null) && (pParams[pToken] !== undefined))
			{
				return String(pParams[pToken]);
			}
			let tmpError = new Error('ServiceSupervisor: unresolved placeholder {' + pToken + '} in ' + pContextLabel);
			tmpError.code = 'SERVICE_PLACEHOLDER_UNRESOLVED';
			throw tmpError;
		});
}

// Substitute a whole argv array; each element is passed through the
// string substituter.
function _substituteArgs(pArgs, pParams, pContextLabel)
{
	let tmpOut = [];
	for (let i = 0; i < pArgs.length; i++)
	{
		tmpOut.push(_substituteString(pArgs[i], pParams, pContextLabel + ' arg[' + i + ']'));
	}
	return tmpOut;
}

// Split a Command string into [ runnable, ...args ].  A whitespace split
// is deliberate and matches the originals, whose commands are simple
// `node <path> serve <path> -p <port>` shapes with no shell quoting; we
// never hand the string to a shell.  Substitution happens BEFORE the
// split so a substituted path with spaces would be a problem — callers
// with space-bearing paths should use the Runnable/Args form instead
// (documented in the definition shape).
function _splitCommand(pCommand)
{
	return String(pCommand).trim().split(/\s+/);
}

// The empty / idle state for a service slot.  Mirrors the union of the
// originals' state fields, generalized.
function _emptyState(pDefinition)
{
	return {
		Name:      (pDefinition && pDefinition.Name) || null,
		State:     'stopped',            // 'stopped' | 'starting' | 'installing' | 'running' | 'failed'
		Running:   false,
		Port:      (pDefinition && (typeof pDefinition.Port !== 'undefined')) ? pDefinition.Port : null,
		Url:       null,
		Pid:       null,
		StartedAt: null,
		Params:    null,
		LastError: null
	};
}

class ServiceSupervisor
{
	/**
	 * @param {object}  [pOptions]
	 * @param {object}  [pOptions.log]      - bunyan/console-like logger; defaults to console.
	 * @param {object}  [pOptions.Services] - map of serviceKey -> service-definition to register up front.
	 */
	constructor(pOptions)
	{
		let tmpOptions = pOptions || {};
		this._log = tmpOptions.log || console;

		// serviceKey -> { Definition, Child, State }.  One live Child per key.
		this._services = {};

		if (tmpOptions.Services && (typeof tmpOptions.Services === 'object'))
		{
			let tmpKeys = Object.keys(tmpOptions.Services);
			for (let i = 0; i < tmpKeys.length; i++)
			{
				this.registerService(tmpKeys[i], tmpOptions.Services[tmpKeys[i]]);
			}
		}

		// Cleanup on manager exit — never orphan a supervised child.  A
		// single guarded registration on the process, shared across every
		// ServiceSupervisor instance, calls shutdownAll() on every live
		// instance.  (The originals each registered their own trio of
		// handlers; here one registry-wide trio covers all services and
		// all instances so we don't leak listeners per instance.)
		if (!process._retoldServiceSupervisorInstances)
		{
			process._retoldServiceSupervisorInstances = [];
			let tmpShutdown = () =>
				{
					let tmpInstances = process._retoldServiceSupervisorInstances || [];
					for (let i = 0; i < tmpInstances.length; i++)
					{
						try { tmpInstances[i].shutdownAll(); } catch (e) { /* best effort */ }
					}
				};
			process.on('exit',    () => { tmpShutdown(); });
			process.on('SIGINT',  () => { tmpShutdown(); process.exit(130); });
			process.on('SIGTERM', () => { tmpShutdown(); process.exit(143); });
		}
		process._retoldServiceSupervisorInstances.push(this);
	}

	/**
	 * Register (or replace) a service definition under a key.  Replacing a
	 * key that has a live child stops that child first so the slot's
	 * definition and its running process never disagree.
	 *
	 * @param {string} pKey        - the service key callers start/stop by.
	 * @param {object} pDefinition - the service-definition (see file header).
	 * @returns {ServiceSupervisor} this (chainable).
	 */
	registerService(pKey, pDefinition)
	{
		if (!pKey) { throw new Error('ServiceSupervisor.registerService requires a key'); }
		if (!pDefinition || (typeof pDefinition !== 'object')) { throw new Error('ServiceSupervisor.registerService requires a definition object for "' + pKey + '"'); }

		if (this._services[pKey] && this._services[pKey].Child)
		{
			this.stop(pKey);
		}

		this._services[pKey] =
			{
				Definition: pDefinition,
				Child:      null,
				State:      _emptyState(pDefinition)
			};
		return this;
	}

	/**
	 * Start a service: substitute placeholders, run any pre-steps, spawn
	 * the long-running server, and poll its port for readiness.  Kills any
	 * in-flight child for this key first (single-active).
	 *
	 * @param {string} pKey      - a registered service key.
	 * @param {object} [pParams] - values for {token} placeholders (docsPath, modulePath, cliPath, …).
	 * @returns {Promise<{ Ok, Port, Pid, State, Url }>}
	 *          Ok=true once the server child is spawned and the port poll
	 *          has resolved (or timed out — we respond anyway, matching the
	 *          originals, since the child may still be coming up).  Ok=false
	 *          with a Message when a pre-step (e.g. npm install) failed.
	 *          Placeholder / spawn errors REJECT (the caller's try/catch is
	 *          the surface for "couldn't even start"), matching the
	 *          originals throwing synchronously from start().
	 */
	start(pKey, pParams)
	{
		let tmpEntry = this._services[pKey];
		if (!tmpEntry) { return Promise.reject(new Error('ServiceSupervisor: no service registered under key "' + pKey + '"')); }

		let tmpDefinition = tmpEntry.Definition;

		// Merge params: definition scalars first (so {Port}/{Name} resolve),
		// caller params last (so caller values win).
		let tmpParams = {};
		let tmpDefKeys = Object.keys(tmpDefinition);
		for (let i = 0; i < tmpDefKeys.length; i++)
		{
			let tmpValue = tmpDefinition[tmpDefKeys[i]];
			if ((typeof tmpValue === 'string') || (typeof tmpValue === 'number') || (typeof tmpValue === 'boolean'))
			{
				tmpParams[tmpDefKeys[i]] = tmpValue;
			}
		}
		let tmpCallerParams = pParams || {};
		let tmpCallerKeys = Object.keys(tmpCallerParams);
		for (let i = 0; i < tmpCallerKeys.length; i++)
		{
			tmpParams[tmpCallerKeys[i]] = tmpCallerParams[tmpCallerKeys[i]];
		}

		// Resolve the step plan (pre-steps + the long-running server) up
		// front so a bad definition / unresolved placeholder throws BEFORE
		// we tear down any in-flight child — a failed start request should
		// not silently kill a working session (the content-editor /
		// examples supervisors validated before stop() for the same
		// reason).
		let tmpSteps;
		let tmpPort;
		let tmpCwd;
		try
		{
			tmpSteps = this._resolveSteps(tmpDefinition, tmpParams);
			tmpPort  = this._resolvePort(tmpDefinition, tmpParams);
			tmpCwd   = this._resolveCwd(tmpDefinition, tmpParams);
		}
		catch (pResolveError)
		{
			this._log.error('ServiceSupervisor[' + pKey + ']: ' + pResolveError.message);
			return Promise.reject(pResolveError);
		}

		// Now safe to kill the in-flight child and take the slot fresh.
		this.stop(pKey);

		tmpEntry.State =
			{
				Name:      tmpDefinition.Name || pKey,
				State:     'starting',
				Running:   true,
				Port:      tmpPort,
				Url:       (tmpPort !== null) ? ('http://127.0.0.1:' + tmpPort + '/') : null,
				Pid:       null,
				StartedAt: Date.now(),
				Params:    tmpParams,
				LastError: null
			};

		let tmpSelf = this;
		let tmpReadyTimeoutMs = (typeof tmpDefinition.ReadyTimeoutMs === 'number') ? tmpDefinition.ReadyTimeoutMs : READY_TIMEOUT_DEFAULT_MS;

		return new Promise((pResolve, pReject) =>
			{
				// Walk the pre-steps (all but the last), each blocking on a
				// clean exit, then spawn the final long-running server.
				let tmpServerStep = tmpSteps[tmpSteps.length - 1];
				let tmpPreSteps   = tmpSteps.slice(0, tmpSteps.length - 1);

				let runServerStep = () =>
					{
						let tmpChild;
						tmpEntry.State.State = 'starting';
						tmpSelf._log.info('ServiceSupervisor[' + pKey + ']: starting ' + tmpServerStep.Runnable + ' '
							+ tmpServerStep.Args.join(' ') + ' (cwd ' + tmpServerStep.Cwd + ', port ' + tmpPort + ')');
						try
						{
							tmpChild = libChildProcess.spawn(tmpServerStep.Runnable, tmpServerStep.Args,
								{
									cwd:      tmpServerStep.Cwd,
									stdio:    [ 'ignore', 'pipe', 'pipe' ],
									detached: false
								});
						}
						catch (pError)
						{
							tmpEntry.State.State     = 'failed';
							tmpEntry.State.Running   = false;
							tmpEntry.State.LastError = pError.message;
							tmpSelf._log.error('ServiceSupervisor[' + pKey + ']: spawn failed — ' + pError.message);
							return pReject(pError);
						}

						tmpEntry.Child = tmpChild;
						tmpEntry.State.Pid = tmpChild.pid;

						tmpChild.on('exit', (pCode) =>
							{
								// If we cleared the child first (stop() / a fresh
								// start()), state was already reset — ignore.
								// Otherwise the child died on its own; reset the
								// slot so the UI chip disappears.  Self-kill vs
								// crash detection, verbatim from the originals.
								if (tmpEntry.Child !== tmpChild) { return; }
								tmpSelf._log.warn('ServiceSupervisor[' + pKey + ']: "' + (tmpDefinition.Name || pKey) + '" exited unexpectedly (code ' + pCode + ')');
								tmpEntry.Child = null;
								tmpEntry.State = _emptyState(tmpDefinition);
							});

						if (tmpChild.stderr)
						{
							tmpChild.stderr.on('data', (pBuf) =>
								{
									let tmpLine = String(pBuf).replace(/\n+$/, '');
									if (tmpLine.length > 0) { tmpSelf._log.warn('[' + pKey + '] ' + tmpLine); }
								});
						}

						// Poll the port; respond once it's up (or the deadline
						// passes — we resolve Ok anyway since the child may
						// still be coming up, matching the originals).
						if (tmpPort !== null)
						{
							_waitForPort(tmpPort, tmpReadyTimeoutMs, (pError) =>
								{
									if (pError)
									{
										tmpSelf._log.warn('ServiceSupervisor[' + pKey + ']: ' + pError.message
											+ ' (responding anyway, child may still be coming up)');
									}
									else if (tmpEntry.Child === tmpChild)
									{
										tmpEntry.State.State = 'running';
									}
									pResolve(tmpSelf._okResult(pKey));
								});
						}
						else
						{
							// No port to poll (a rare service): report running immediately.
							tmpEntry.State.State = 'running';
							pResolve(tmpSelf._okResult(pKey));
						}
					};

				// Run pre-steps in order; each must exit 0.  A pre-step that
				// carries SkipIfExists whose path is present is skipped.
				let runPreStep = (pIndex) =>
					{
						if (pIndex >= tmpPreSteps.length)
						{
							return runServerStep();
						}
						let tmpStep = tmpPreSteps[pIndex];

						if (tmpStep.SkipIfExists && libFs.existsSync(libPath.join(tmpStep.Cwd, tmpStep.SkipIfExists)))
						{
							return runPreStep(pIndex + 1);
						}

						tmpEntry.State.State = tmpStep.Phase || 'installing';
						tmpSelf._log.info('ServiceSupervisor[' + pKey + ']: pre-step ' + tmpStep.Runnable + ' '
							+ tmpStep.Args.join(' ') + ' (cwd ' + tmpStep.Cwd + ')');

						let tmpChild;
						try
						{
							tmpChild = libChildProcess.spawn(tmpStep.Runnable, tmpStep.Args,
								{
									cwd:      tmpStep.Cwd,
									stdio:    [ 'ignore', 'pipe', 'pipe' ],
									detached: false
								});
						}
						catch (pError)
						{
							tmpEntry.State.State     = 'failed';
							tmpEntry.State.Running   = false;
							tmpEntry.State.LastError = pError.message;
							return pReject(pError);
						}

						tmpEntry.Child = tmpChild;
						tmpEntry.State.Pid = tmpChild.pid;

						if (tmpChild.stderr)
						{
							tmpChild.stderr.on('data', (pBuf) =>
								{
									let tmpLine = String(pBuf).replace(/\n+$/, '');
									if (tmpLine.length > 0) { tmpSelf._log.warn('[' + pKey + '-prestep] ' + tmpLine); }
								});
						}

						tmpChild.on('exit', (pCode) =>
							{
								if (tmpEntry.Child !== tmpChild) { return; }
								tmpEntry.Child = null;
								if (pCode === 0)
								{
									return runPreStep(pIndex + 1);
								}
								// Pre-step failed: report a soft failure (Ok:false)
								// rather than rejecting — this matches the
								// ExamplesSupervisor surfacing an install failure
								// via state rather than an outright throw.
								tmpEntry.State.State     = 'failed';
								tmpEntry.State.Running   = false;
								tmpEntry.State.LastError = tmpStep.Runnable + ' ' + tmpStep.Args.join(' ') + ' exited with code ' + pCode;
								tmpSelf._log.warn('ServiceSupervisor[' + pKey + ']: ' + tmpEntry.State.LastError);
								pResolve({ Ok: false, State: 'failed', Port: tmpPort, Pid: null, Url: tmpEntry.State.Url, Message: tmpEntry.State.LastError });
							});
					};

				runPreStep(0);
			});
	}

	/**
	 * Stop a service: SIGTERM its live child (install OR serve) and reset
	 * the slot to idle.  Idempotent — a no-op (returning stopped) when
	 * nothing is running or the key is unknown.
	 *
	 * @param {string} pKey - a registered service key.
	 * @returns {Promise<{ Ok, State }>}
	 */
	stop(pKey)
	{
		let tmpEntry = this._services[pKey];
		if (!tmpEntry)
		{
			return Promise.resolve({ Ok: true, State: 'stopped' });
		}
		if (!tmpEntry.Child)
		{
			tmpEntry.State = _emptyState(tmpEntry.Definition);
			return Promise.resolve({ Ok: true, State: 'stopped' });
		}
		let tmpChild = tmpEntry.Child;
		tmpEntry.Child = null;  // clear first so the 'exit' handler bails (self-kill, not crash)
		try { tmpChild.kill('SIGTERM'); }
		catch (pError) { /* already dead */ }
		tmpEntry.State = _emptyState(tmpEntry.Definition);
		return Promise.resolve({ Ok: true, State: 'stopped' });
	}

	/**
	 * Snapshot status.  With a key, returns that service's status; with no
	 * key, returns a map of every registered key -> status.  Each status
	 * is a shallow clone so callers can freely mutate / serialize.
	 *
	 * @param {string} [pKey]
	 * @returns {{ State, Port, Pid, StartedAt, ... }} | { [key]: status }
	 */
	status(pKey)
	{
		if (typeof pKey !== 'undefined')
		{
			let tmpEntry = this._services[pKey];
			if (!tmpEntry) { return null; }
			return Object.assign({}, tmpEntry.State);
		}
		let tmpAll = {};
		let tmpKeys = Object.keys(this._services);
		for (let i = 0; i < tmpKeys.length; i++)
		{
			tmpAll[tmpKeys[i]] = Object.assign({}, this._services[tmpKeys[i]].State);
		}
		return tmpAll;
	}

	/**
	 * Kill every live child across all registered services (for a clean
	 * server shutdown).  Idempotent.
	 */
	shutdownAll()
	{
		let tmpKeys = Object.keys(this._services);
		for (let i = 0; i < tmpKeys.length; i++)
		{
			this.stop(tmpKeys[i]);
		}
	}

	// --- internals ------------------------------------------------------

	// Build the { Ok } result for a successfully-started service.
	_okResult(pKey)
	{
		let tmpState = this._services[pKey].State;
		return {
			Ok:    true,
			Port:  tmpState.Port,
			Pid:   tmpState.Pid,
			State: tmpState.State,
			Url:   tmpState.Url
		};
	}

	// Resolve the effective port for a definition (after substitution),
	// or null if the service has no Port.
	_resolvePort(pDefinition, pParams)
	{
		if ((typeof pDefinition.Port === 'undefined') || (pDefinition.Port === null)) { return null; }
		if (typeof pDefinition.Port === 'number') { return pDefinition.Port; }
		let tmpResolved = _substituteString(pDefinition.Port, pParams, (pDefinition.Name || 'service') + ' Port');
		let tmpNumber = parseInt(tmpResolved, 10);
		return isNaN(tmpNumber) ? null : tmpNumber;
	}

	// Resolve a step's Cwd (step Cwd > definition Cwd > process cwd), with
	// placeholder substitution.
	_resolveCwd(pDefinition, pParams)
	{
		if (pDefinition.Cwd) { return _substituteString(pDefinition.Cwd, pParams, (pDefinition.Name || 'service') + ' Cwd'); }
		return process.cwd();
	}

	// Turn a definition into an ordered array of concrete steps:
	//   [ ...preSteps, serverStep ]
	// each { Runnable, Args[], Cwd, SkipIfExists?, Phase? } fully
	// substituted.  The LAST entry is always the long-running server.
	_resolveSteps(pDefinition, pParams)
	{
		let tmpLabel   = pDefinition.Name || 'service';
		let tmpBaseCwd = this._resolveCwd(pDefinition, pParams);

		// Normalize the long-running server command from either the
		// Command string or the Runnable/Args pair.
		let tmpServerStep = this._resolveCommandStep(pDefinition, pParams, tmpBaseCwd, tmpLabel);

		let tmpPreSteps = [];

		// Explicit Steps array wins: everything but the last is a pre-step,
		// the last is the server.  (When Steps is present we IGNORE the
		// top-level Command/Runnable and use Steps' final entry as the
		// server, matching the "fully general" documented form.)
		if (Array.isArray(pDefinition.Steps) && (pDefinition.Steps.length > 0))
		{
			let tmpResolvedSteps = [];
			for (let i = 0; i < pDefinition.Steps.length; i++)
			{
				let tmpRaw = pDefinition.Steps[i];
				let tmpStepCwd = tmpRaw.Cwd ? _substituteString(tmpRaw.Cwd, pParams, tmpLabel + ' Steps[' + i + '].Cwd') : tmpBaseCwd;
				let tmpStep = this._resolveCommandStep(tmpRaw, pParams, tmpStepCwd, tmpLabel + ' Steps[' + i + ']');
				if (tmpRaw.SkipIfExists) { tmpStep.SkipIfExists = tmpRaw.SkipIfExists; }
				if (tmpRaw.Phase)        { tmpStep.Phase = tmpRaw.Phase; }
				tmpResolvedSteps.push(tmpStep);
			}
			return tmpResolvedSteps;
		}

		// InstallFirst shorthand: prepend an `npm install` pre-step that
		// skips when node_modules/ already exists (ExamplesSupervisor).
		if (pDefinition.InstallFirst)
		{
			tmpPreSteps.push({
				Runnable:     'npm',
				Args:         [ 'install' ],
				Cwd:          tmpBaseCwd,
				SkipIfExists: 'node_modules',
				Phase:        'installing'
			});
		}

		tmpPreSteps.push(tmpServerStep);
		return tmpPreSteps;
	}

	// Normalize a single command source ({Command} OR {Runnable,Args}) into
	// a concrete, substituted { Runnable, Args[], Cwd } step.
	_resolveCommandStep(pSource, pParams, pCwd, pLabel)
	{
		let tmpRunnable;
		let tmpArgs;

		if (typeof pSource.Command === 'string')
		{
			let tmpSubstituted = _substituteString(pSource.Command, pParams, pLabel + ' Command');
			let tmpParts = _splitCommand(tmpSubstituted);
			tmpRunnable = tmpParts[0];
			tmpArgs = tmpParts.slice(1);
		}
		else if (typeof pSource.Runnable === 'string')
		{
			tmpRunnable = _substituteString(pSource.Runnable, pParams, pLabel + ' Runnable');
			tmpArgs = _substituteArgs(Array.isArray(pSource.Args) ? pSource.Args : [], pParams, pLabel + ' Args');
		}
		else
		{
			throw new Error('ServiceSupervisor: ' + pLabel + ' has neither a Command string nor a Runnable');
		}

		return { Runnable: tmpRunnable, Args: tmpArgs, Cwd: pCwd };
	}
}

module.exports = ServiceSupervisor;
