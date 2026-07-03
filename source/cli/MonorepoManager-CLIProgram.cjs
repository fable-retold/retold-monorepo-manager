/**
 * MonorepoManager-CLIProgram
 *
 * Builds the pict-service-commandlineutility program from the declarative CommandMap.
 * Mirrors the ultravisor CLI convention: this module constructs and exports the program
 * instance; the bin shim (MonorepoManager-Run.cjs) calls `.run()` on it.
 */
const libCLIProgram = require('pict-service-commandlineutility');

const libPackage = require('../../package.json');
const libCommandMap = require('./MonorepoManager-CommandMap.cjs');
const libCommandFactory = require('./MonorepoManager-CommandFactory.cjs');

// TODO (Phase 3): Restify warning suppression when the web server is wired.

// Shared context every generated command hands to its handler.
let _Shared = { Package: libPackage };

let _CommandClasses = libCommandFactory.buildCommandClasses(libCommandMap, _Shared);

let _Program = new libCLIProgram(
	{
		"Product": "retold-monorepo-manager",
		"Version": libPackage.version,
		"Description": libPackage.description,

		"Package": libPackage,

		// Keep the console quiet for a CLI — handlers print their own user-facing output.
		// RETOLD_LOG_NOISINESS / -v style verbosity can be layered in later.
		"LogStreams":
			[
				{
					"level": "error",
					"streamtype": "process.stdout"
				}
			],

		"Command": "monorepo-manager",

		"DefaultProgramConfiguration": require('../config/MonorepoManager-Default-Command-Configuration.cjs'),

		"ProgramConfigurationFileName": ".monorepo-manager.json",

		"AutoGatherProgramConfiguration": true,
		"AutoAddConfigurationExplanationCommand": true
	},
	_CommandClasses);

module.exports = _Program;
