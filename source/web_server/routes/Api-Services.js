/**
 * Api-Services — generic long-running service supervision, driven by the ServiceSupervisor.
 *
 * Services are registered at server setup from the manifest: one per module that declares a
 * `Service: { Entry, Port, StartCommand }` block, plus any `DevServers` entries (e.g. docs/examples
 * dev servers) — all config-driven, no tool names hardcoded. Routes just drive the supervisor by key.
 */
function respondError(pRes, pStatus, pCode, pMessage)
{
	pRes.statusCode = pStatus;
	pRes.send({ Error: pCode, Message: pMessage });
}

module.exports = function registerServicesRoutes(pCore)
{
	let tmpOrator = pCore.Orator;
	let tmpSupervisor = pCore.ServiceSupervisor;

	// List every registered service + its state.
	tmpOrator.serviceServer.doGet('/api/manager/services', function (pReq, pRes, pNext)
		{
			pRes.send({ Services: tmpSupervisor.status() });
			return pNext();
		});

	tmpOrator.serviceServer.doGet('/api/manager/services/:key/status', function (pReq, pRes, pNext)
		{
			let tmpStatus = tmpSupervisor.status(pReq.params.key);
			if (!tmpStatus) { respondError(pRes, 404, 'UnknownService', `No such service: ${pReq.params.key}`); return pNext(); }
			pRes.send(tmpStatus);
			return pNext();
		});

	tmpOrator.serviceServer.doPost('/api/manager/services/:key/start', function (pReq, pRes, pNext)
		{
			let tmpBody = pReq.body || {};
			let tmpParams = tmpBody.Params || {};
			Promise.resolve(tmpSupervisor.start(pReq.params.key, tmpParams)).then(
				(pResult) => { pRes.send(pResult); return pNext(); },
				(pError) => { respondError(pRes, 500, 'ServiceStartFailed', pError.message); return pNext(); });
		});

	tmpOrator.serviceServer.doPost('/api/manager/services/:key/stop', function (pReq, pRes, pNext)
		{
			Promise.resolve(tmpSupervisor.stop(pReq.params.key)).then(
				(pResult) => { pRes.send(pResult); return pNext(); },
				(pError) => { respondError(pRes, 500, 'ServiceStopFailed', pError.message); return pNext(); });
		});
};
