/**
 * retold-monorepo-manager — library barrel.
 *
 * Exposes the reusable core so the tool can be embedded, and so the CLI + (future) web
 * server share exactly one implementation of each capability. Grows one entry per core
 * module as the phases land.
 */
module.exports =
	({
		// Config core (Phase 1)
		ManifestLocator: require('./core/Manager-Core-ManifestLocator.js'),
		ManifestLoader: require('./core/Manager-Core-ManifestLoader.js'),
		ModuleCatalog: require('./core/Manager-Core-ModuleCatalog.js'),
		ManifestDiscovery: require('./core/Manager-Core-ManifestDiscovery.js'),
		ManifestTools: require('./core/Manager-Core-ManifestTools.js'),
		ManifestMigrate: require('./core/Manager-Core-ManifestMigrate.js'),

		// Command core (Phase 2)
		ProcessRunner: require('./core/Manager-Core-ProcessRunner.js'),
		OperationLogger: require('./core/Manager-Core-OperationLogger.js'),
		CommitComposer: require('./core/Manager-Core-CommitComposer.js'),
		GitUtils: require('./core/Manager-Core-GitUtils.js'),
		PrePublishValidator: require('./core/Manager-Core-PrePublishValidator.js'),
		ModuleIntrospector: require('./core/Manager-Core-ModuleIntrospector.js'),
		DepAligner: require('./core/Manager-Core-DepAligner.js'),
		ServiceSupervisor: require('./core/Manager-Core-ServiceSupervisor.js'),

		// Bulk operations — planning (Phase 5a/5c)
		DependencyGraph: require('./bulk/DependencyGraph.js'),
		GraphSource: require('./bulk/GraphSource.js'),
		Planners: require('./bulk/Planners.js'),
		BulkCatalog: require('./bulk/BulkOperation-Catalog.js'),
		BulkTasks: require('./bulk/tasks/BuiltInTasks.js'),

		// Bulk operations — execution (Phase 5b)
		BulkEngine: require('./bulk/BulkOperation-Engine.js'),
		BulkManifest: require('./bulk/BulkOperation-Manifest.js'),
		BulkTaskRegistry: require('./bulk/BulkOperation-TaskRegistry.js'),
		BulkStatus: require('./bulk/BulkOperation-Status.js'),

		// Web server (Phase 3)
		Server: require('./web_server/MonorepoManager-Server.js'),
		OperationBroadcaster: require('./web_server/Manager-OperationBroadcaster.js'),
		ProcessStreamBridge: require('./web_server/Manager-ProcessStreamBridge.js'),

		// CLI wiring (also reused by the web client's action layer from Phase 4).
		CommandMap: require('./cli/MonorepoManager-CommandMap.cjs'),
		CommandFactory: require('./cli/MonorepoManager-CommandFactory.cjs')
	});
