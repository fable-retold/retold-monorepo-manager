/**
 * BulkOperation-Factory — builds a ready BulkOperationEngine (registry loaded with the built-in
 * task types + a durable manifest) so the CLI and web server construct it identically.
 */
const libTaskRegistry = require('./BulkOperation-TaskRegistry.js');
const libManifest = require('./BulkOperation-Manifest.js');
const libEngine = require('./BulkOperation-Engine.js');
const libTasks = require('./tasks/BuiltInTasks.js');

/**
 * @param {object} pOptions - { Loader, Introspector, Validator, Broadcaster?, OnEvent?, LogDir?,
 *                              DefaultConcurrency?, Log? }
 * @returns {libEngine}
 */
function createEngine(pOptions)
{
	let tmpOptions = pOptions || {};
	let tmpLogDir = tmpOptions.LogDir || (tmpOptions.Loader && tmpOptions.Loader.getRepoRoot && tmpOptions.Loader.getRepoRoot()) || '.';
	let tmpRegistry = new libTaskRegistry().registerAll(libTasks);
	let tmpManifest = new libManifest({ LogDir: tmpLogDir, Log: tmpOptions.Log });
	return new libEngine(
		{
			Loader: tmpOptions.Loader,
			Introspector: tmpOptions.Introspector,
			Validator: tmpOptions.Validator,
			Registry: tmpRegistry,
			Manifest: tmpManifest,
			Broadcaster: tmpOptions.Broadcaster || null,
			OnEvent: tmpOptions.OnEvent || null,
			DefaultConcurrency: tmpOptions.DefaultConcurrency || 4,
			Log: tmpOptions.Log
		});
}

module.exports = { createEngine };
