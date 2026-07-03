/**
 * MonorepoManager-Server — Orator web transport.
 *
 * Composes: Fable → Orator (restify) → shared core services → REST routes → WebSocket broadcaster →
 * static files. The SAME transport-agnostic core the CLI uses backs every route, so the web and CLI
 * can't diverge. Points at a target monorepo via the injected ManifestLoader. Fork/upstream/ripple
 * routes do not exist here.
 *
 *   setupServer({ Loader, Port, Host, DistPath }, fCallback)
 *   fCallback(pError, { Fable, Orator, Broadcaster, Port, Host, ModuleCount, Core })
 */
const libPath = require('path');
const libFS = require('fs');

const libFable = require('fable');
const libOrator = require('orator');
const libOratorServiceServerRestify = require('orator-serviceserver-restify');

const libModuleIntrospector = require('../core/Manager-Core-ModuleIntrospector.js');
const libPrePublishValidator = require('../core/Manager-Core-PrePublishValidator.js');
const libProcessRunner = require('../core/Manager-Core-ProcessRunner.js');
const libOperationLogger = require('../core/Manager-Core-OperationLogger.js');
const libServiceSupervisor = require('../core/Manager-Core-ServiceSupervisor.js');
const libModuleCatalog = require('../core/Manager-Core-ModuleCatalog.js');
const libBulkFactory = require('../bulk/BulkOperation-Factory.js');

const libOperationBroadcaster = require('./Manager-OperationBroadcaster.js');
const libProcessStreamBridge = require('./Manager-ProcessStreamBridge.js');

const libRoutesManifest = require('./routes/Api-Manifest.js');
const libRoutesManifestEdit = require('./routes/Api-ManifestEdit.js');
const libRoutesOperations = require('./routes/Api-Operations.js');
const libRoutesFiles = require('./routes/Api-Files.js');
const libRoutesServices = require('./routes/Api-Services.js');
const libRoutesGraph = require('./routes/Api-Graph.js');
const libRoutesBulk = require('./routes/Api-Bulk.js');

const libPackage = require('../../package.json');

/**
 * Build the ServiceSupervisor's service registry from the manifest: one service per module that
 * declares a Service block, plus each DevServers entry (module supplied at start via {modulePath}).
 */
function buildServiceRegistry(pLoader)
{
	let tmpServices = {};
	let tmpConfig = pLoader.getConfig();

	let tmpModules = pLoader.getAllModules();
	for (let i = 0; i < tmpModules.length; i++)
	{
		let tmpModule = tmpModules[i];
		if (tmpModule.Service && (tmpModule.Service.StartCommand || tmpModule.Service.Entry))
		{
			tmpServices[tmpModule.Name] =
				{
					Name: tmpModule.Name,
					Port: tmpModule.Service.Port || 0,
					Command: tmpModule.Service.StartCommand || `node ${tmpModule.Service.Entry}`,
					Cwd: tmpModule.AbsolutePath
				};
		}
	}

	let tmpDevServers = tmpConfig.DevServers || {};
	Object.keys(tmpDevServers).forEach((pKind) =>
		{
			let tmpDefinition = tmpDevServers[pKind];
			tmpServices[`devserver:${pKind}`] =
				{
					Name: pKind,
					Port: tmpDefinition.Port || 0,
					Command: tmpDefinition.Command,
					Cwd: tmpDefinition.Cwd || '{modulePath}'
				};
		});

	return tmpServices;
}

function setupServer(pOptions, fCallback)
{
	let tmpLoader = pOptions.Loader;
	tmpLoader.ensureLoaded();
	let tmpConfig = tmpLoader.getConfig();

	let tmpPort = pOptions.Port || tmpConfig.WebServer.Port || 44444;
	let tmpHost = pOptions.Host || tmpConfig.WebServer.Host || '127.0.0.1';
	let tmpDistPath = pOptions.DistPath;

	let tmpFable = new libFable(
		{
			Product: 'Monorepo-Manager',
			ProductVersion: libPackage.version,
			APIServerPort: tmpPort,
			LogStreams: [ { loggertype: 'console', streamtype: 'console', level: 'info' } ]
		});

	tmpFable.serviceManager.addServiceType('OratorServiceServer', libOratorServiceServerRestify);
	tmpFable.serviceManager.instantiateServiceProvider('OratorServiceServer');
	tmpFable.serviceManager.addServiceType('Orator', libOrator);
	let tmpOrator = tmpFable.serviceManager.instantiateServiceProvider('Orator');

	// Shared core (same instances the CLI would build).
	let tmpIntrospector = new libModuleIntrospector({ manifest: tmpLoader, log: tmpFable.log, RemoteName: tmpConfig.GitRemote, DefaultBranch: tmpConfig.DefaultBranch });
	let tmpValidator = new libPrePublishValidator({ introspector: tmpIntrospector, ManifestLoader: tmpLoader, log: tmpFable.log });
	let tmpProcessRunner = new libProcessRunner({ log: tmpFable.log });
	let tmpServiceSupervisor = new libServiceSupervisor({ log: tmpFable.log, Services: buildServiceRegistry(tmpLoader) });

	let tmpOperationLogger = new libOperationLogger(
		{
			RepoRoot: tmpLoader.getRepoRoot(),
			LogDir: (tmpConfig.Logging && tmpConfig.Logging.LogDir) || tmpLoader.getRepoRoot(),
			LogFilePrefix: (tmpConfig.Logging && tmpConfig.Logging.LogFilePrefix) || 'Monorepo-Manager-Operations-',
			ProcessRunner: tmpProcessRunner,
			Log: tmpFable.log
		});
	tmpFable.log.info('Operation log file: ' + tmpOperationLogger.getLogPath());

	tmpFable.serviceManager.addServiceType('ManagerOperationBroadcaster', libOperationBroadcaster);
	let tmpBroadcaster = tmpFable.serviceManager.instantiateServiceProvider('ManagerOperationBroadcaster');
	let tmpStreamBridge = new libProcessStreamBridge(tmpProcessRunner, tmpBroadcaster);

	// Bulk-operation engine — the shared executor for ripple + all flat bulk ops. Streams over the
	// same broadcaster (bulk-* frames), persists runs under the repo root.
	let tmpBulkEngine = libBulkFactory.createEngine(
		{
			Loader: tmpLoader,
			Introspector: tmpIntrospector,
			Validator: tmpValidator,
			Broadcaster: tmpBroadcaster,
			LogDir: (tmpConfig.Logging && tmpConfig.Logging.LogDir === '.') ? tmpLoader.getRepoRoot() : ((tmpConfig.Logging && tmpConfig.Logging.LogDir) || tmpLoader.getRepoRoot()),
			DefaultConcurrency: 4,
			Log: tmpFable.log
		});

	let tmpCore =
		{
			Fable: tmpFable,
			Orator: tmpOrator,
			Loader: tmpLoader,
			Catalog: new libModuleCatalog(tmpLoader),
			Introspector: tmpIntrospector,
			Validator: tmpValidator,
			ProcessRunner: tmpProcessRunner,
			ServiceSupervisor: tmpServiceSupervisor,
			Broadcaster: tmpBroadcaster,
			StreamBridge: tmpStreamBridge,
			Logger: tmpOperationLogger,
			BulkEngine: tmpBulkEngine,
			Package: libPackage
		};

	tmpOrator.initialize(function (pInitError)
		{
			if (pInitError) { return fCallback(pInitError); }

			let tmpServer = tmpOrator.serviceServer.server;

			// Body parser (returns an array of middleware — bind to the raw restify server).
			tmpServer.use(tmpOrator.serviceServer.bodyParser());

			// Deterministic query parsing (restify's queryParser isn't registered by orator here).
			tmpServer.use(function (pReq, pRes, pNext)
				{
					let tmpQueryString = (pReq.url || '').split('?')[1] || '';
					pReq.query = Object.fromEntries(new URLSearchParams(tmpQueryString));
					return pNext();
				});

			// Identity header + auth seam. Auth is OFF unless the manifest enables it; the mount point
			// and defensive UserID read are all that live here now (no user model is built).
			tmpServer.use(function (pReq, pRes, pNext)
				{
					pRes.setHeader('X-Monorepo-Manager', libPackage.version);
					if (pReq.UserID === undefined) { pReq.UserID = null; }
					return pNext();
				});
			if (tmpConfig.Auth && tmpConfig.Auth.Enabled)
			{
				tmpFable.log.warn('Auth.Enabled is set, but no authentication provider is wired yet (Phase 3 leaves the seam only).');
			}

			// Routes (all through one wiring block — a future authorization wrapper decorates here).
			libRoutesManifest(tmpCore);
			libRoutesManifestEdit(tmpCore);
			libRoutesOperations(tmpCore);
			libRoutesFiles(tmpCore);
			libRoutesServices(tmpCore);
			libRoutesGraph(tmpCore);
			libRoutesBulk(tmpCore);

			// Health.
			tmpOrator.serviceServer.doGet('/api/manager/health', function (pReq, pRes, pNext)
				{
					pRes.send(
						{
							Product: 'Monorepo-Manager',
							Version: libPackage.version,
							Manifest: tmpLoader.getManifestPath(),
							ModuleCount: tmpLoader.getAllModuleNames().length,
							ServerTime: new Date().toISOString()
						});
					return pNext();
				});

			// Static web UI (Phase 4). Serve the built bundle if present; otherwise a placeholder that
			// confirms the API is live.
			let tmpHasDist = tmpDistPath && libFS.existsSync(libPath.join(tmpDistPath, 'index.html'));
			if (tmpHasDist)
			{
				tmpOrator.addStaticRoute(`${tmpDistPath}/`, 'index.html', '/*', '/');
			}
			else
			{
				tmpOrator.serviceServer.doGet('/', function (pReq, pRes, pNext)
					{
						pRes.setHeader('Content-Type', 'text/html; charset=utf-8');
						pRes.send('<!doctype html><meta charset="utf-8"><title>Monorepo Manager</title>'
							+ '<body style="font:14px system-ui;max-width:40rem;margin:3rem auto;color:#233">'
							+ '<h1>Monorepo Manager</h1><p>The REST API is live under <code>/api/manager/*</code> '
							+ 'and the operation stream is at <code>/ws/manager/operations</code>. The web UI ships in Phase 4.</p>'
							+ `<p><a href="/api/manager/health">/api/manager/health</a> · <a href="/api/manager/modules">/api/manager/modules</a></p></body>`);
						return pNext();
					});
			}

			tmpServer.listen(tmpPort, tmpHost, function (pListenError)
				{
					if (pListenError) { return fCallback(pListenError); }

					tmpOrator.serviceServer.Active = true;
					tmpOrator.serviceServer.Port = tmpPort;

					try
					{
						let tmpHttpServer = tmpServer.server ? tmpServer.server : null;
						if (tmpHttpServer) { tmpBroadcaster.attachTo(tmpHttpServer); }
						else { tmpFable.log.warn('OperationBroadcaster: could not find underlying http.Server; WebSocket unavailable'); }
					}
					catch (pAttachError) { tmpFable.log.warn('OperationBroadcaster attach failed: ' + pAttachError.message); }

					return fCallback(null,
						{
							Fable: tmpFable,
							Orator: tmpOrator,
							Broadcaster: tmpBroadcaster,
							Port: tmpPort,
							Host: tmpHost,
							ModuleCount: tmpLoader.getAllModuleNames().length,
							Core: tmpCore
						});
				});
		});
}

module.exports = setupServer;
module.exports.buildServiceRegistry = buildServiceRegistry;
