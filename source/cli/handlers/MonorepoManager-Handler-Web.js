/**
 * Handler: `mm web` — start the Orator web server + WebSocket operation stream.
 *
 * Long-running: the returned promise never resolves, so the command stays "running" and the process
 * lives on the listening socket until Ctrl-C. SIGINT/SIGTERM shut the supervisor + broadcaster down.
 */
const libPath = require('path');
const libChildProcess = require('child_process');

const libSupport = require('./MonorepoManager-Handler-Support.js');
const libServer = require('../../web_server/MonorepoManager-Server.js');

function openBrowser(pUrl)
{
	let tmpCommand;
	switch (process.platform)
	{
		case 'darwin': tmpCommand = `open "${pUrl}"`; break;
		case 'win32':  tmpCommand = `start "" "${pUrl}"`; break;
		default:       tmpCommand = `xdg-open "${pUrl}"`; break;
	}
	libChildProcess.exec(tmpCommand, function (pError)
		{
			if (pError) { console.error('Could not auto-open browser:', pError.message); }
		});
}

module.exports = async function web(pContext)
{
	let tmpLoader = libSupport.loaderFromContext(pContext);
	let tmpConfig = tmpLoader.getConfig();
	let tmpOptions = pContext.Options || {};

	let tmpPort = tmpOptions.port ? parseInt(tmpOptions.port, 10) : (tmpConfig.WebServer.Port || 44444);
	let tmpHost = tmpOptions.host || tmpConfig.WebServer.Host || '127.0.0.1';
	let tmpDistPath = libPath.resolve(__dirname, '..', '..', '..', 'webinterface', 'dist');

	return new Promise(() =>
		{
			libServer({ Loader: tmpLoader, Port: tmpPort, Host: tmpHost, DistPath: tmpDistPath }, function (pError, pInfo)
				{
					if (pError)
					{
						console.error('Failed to start web server:', pError.message);
						process.exitCode = 1;
						process.exit(1);
						return;
					}

					let tmpUrl = `http://${pInfo.Host}:${pInfo.Port}/`;
					console.log('');
					console.log('  Monorepo Manager Web');
					console.log('  ' + tmpUrl);
					console.log('  ' + pInfo.ModuleCount + ' modules from ' + tmpLoader.getManifestPath());
					console.log('');
					console.log('  Ctrl-C to stop.');
					console.log('');

					if (tmpOptions.open) { openBrowser(tmpUrl); }

					function shutdown()
					{
						try { if (pInfo.Core && pInfo.Core.ServiceSupervisor) { pInfo.Core.ServiceSupervisor.shutdownAll(); } } catch (pShutdownError) { /* ignore */ }
						try { if (pInfo.Broadcaster) { pInfo.Broadcaster.shutdown(); } } catch (pShutdownError) { /* ignore */ }
						process.exit(0);
					}
					process.on('SIGINT', shutdown);
					process.on('SIGTERM', shutdown);
				});
			// Intentionally never resolves — the server keeps the process alive until a signal.
		});
};
