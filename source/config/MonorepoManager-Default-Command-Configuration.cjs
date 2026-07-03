/**
 * Default program configuration for the CLI, gathered by pict-service-commandlineutility
 * (AutoGatherProgramConfiguration). A user's .monorepo-manager.json and any --config file
 * are layered on top of these defaults. Most operational config actually lives in the
 * monorepo's Modules-Manifest.json — this block is only the tool's own runtime knobs.
 */
module.exports =
	({
		"ManifestFileName": "Modules-Manifest.json",

		// Web mode (Phase 3) binds here unless the manifest's WebServer block overrides it.
		"WebServerPort": 44444,
		"WebServerHost": "127.0.0.1"
	});
