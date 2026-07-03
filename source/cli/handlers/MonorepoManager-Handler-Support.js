/**
 * Shared helpers for CLI command handlers — building core services from a command context,
 * resolving modules, and streaming a ProcessRunner operation to the terminal.
 */
const libManifestLoader = require('../../core/Manager-Core-ManifestLoader.js');
const libModuleIntrospector = require('../../core/Manager-Core-ModuleIntrospector.js');
const libProcessRunner = require('../../core/Manager-Core-ProcessRunner.js');

/**
 * Build and load a ManifestLoader from a command context. Honors `--manifest <path>`; otherwise
 * walks up from the current directory.
 * @param {object} pContext
 * @returns {libManifestLoader}
 */
function loaderFromContext(pContext)
{
	let tmpOptions = (pContext && pContext.Options) || {};
	let tmpLoader = new libManifestLoader(
		{
			ManifestPath: tmpOptions.manifest || null,
			StartDirectory: process.cwd()
		});
	tmpLoader.load();
	return tmpLoader;
}

/**
 * Build an origin-only ModuleIntrospector wired to a loaded manifest.
 * @param {libManifestLoader} pLoader
 * @returns {libModuleIntrospector}
 */
function introspectorFromContext(pLoader)
{
	let tmpConfig = pLoader.getConfig();
	return new libModuleIntrospector(
		{
			manifest: pLoader,
			RemoteName: tmpConfig.GitRemote,
			DefaultBranch: tmpConfig.DefaultBranch
		});
}

function newProcessRunner()
{
	return new libProcessRunner({});
}

/**
 * Resolve a module by name from a loaded manifest, throwing a friendly error if unknown.
 * @param {libManifestLoader} pLoader
 * @param {string} pName
 * @returns {object} the manifest module entry (with AbsolutePath)
 */
function resolveModule(pLoader, pName)
{
	let tmpModule = pLoader.getModule(pName);
	if (!tmpModule)
	{
		throw new Error(`Unknown module: ${pName} (not in the manifest).`);
	}
	return tmpModule;
}

/**
 * Stream a ProcessRunner operation (single command or sequence) to the terminal, resolving with the
 * final exit code. `pStart` is a thunk that actually kicks off the op (so callers choose run vs
 * runSequence). Never rejects on a non-zero exit — only on a spawn/runtime error.
 * @param {libProcessRunner} pRunner
 * @param {Function} pStart - () => void that calls pRunner.run(...) / pRunner.runSequence(...)
 * @returns {Promise<number>} the exit code (or a synthesized non-zero on abort)
 */
function streamOperation(pRunner, pStart)
{
	return new Promise((pResolve, pReject) =>
	{
		function onLine(pEvent)
		{
			let tmpStream = (pEvent.Channel === 'stderr') ? process.stderr : process.stdout;
			tmpStream.write(pEvent.Text + '\n');
		}
		function cleanup()
		{
			pRunner.removeListener('line', onLine);
			pRunner.removeListener('end', onEnd);
			pRunner.removeListener('error', onError);
		}
		function onEnd(pEvent)
		{
			// runSequence emits an `end` per step; only the last (or an aborted) one is terminal.
			if ((pEvent.IsLastStep === false) && (pEvent.Aborted !== true)) { return; }
			cleanup();
			pResolve(typeof pEvent.ExitCode === 'number' ? pEvent.ExitCode : 0);
		}
		function onError(pEvent)
		{
			cleanup();
			pReject(new Error(pEvent.Message || 'operation failed'));
		}

		pRunner.on('line', onLine);
		pRunner.on('end', onEnd);
		pRunner.once('error', onError);

		pStart();
	});
}

module.exports = { loaderFromContext, introspectorFromContext, newProcessRunner, resolveModule, streamOperation };
