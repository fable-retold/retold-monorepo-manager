/**
 * Api-Graph — the pure dependency-graph surface (no side effects): the graph JSON for the client
 * visualization, and blast-radius (impact) queries.
 */
const libGraphSource = require('../../bulk/GraphSource.js');

module.exports = function registerGraphRoutes(pCore)
{
	let tmpOrator = pCore.Orator;
	let tmpLoader = pCore.Loader;

	tmpOrator.serviceServer.doGet('/api/manager/graph', function (pReq, pRes, pNext)
		{
			pRes.send(libGraphSource.buildGraph(tmpLoader).toVisualizationJSON());
			return pNext();
		});

	tmpOrator.serviceServer.doGet('/api/manager/graph/impact/:name', function (pReq, pRes, pNext)
		{
			let tmpName = pReq.params.name;
			if (!tmpLoader.getModule(tmpName))
			{
				pRes.statusCode = 404;
				pRes.send({ Error: 'UnknownModule', Message: `Unknown module: ${tmpName}` });
				return pNext();
			}
			let tmpGraph = libGraphSource.buildGraph(tmpLoader);
			let tmpImpacted = tmpGraph.impactOf([ tmpName ], {});
			let tmpOrdered = tmpGraph.topoOrder([ tmpName ].concat(tmpImpacted), {}).filter((pModule) => (pModule !== tmpName));
			pRes.send({ Root: tmpName, Impacted: tmpImpacted, Ordered: tmpOrdered, Count: tmpImpacted.length });
			return pNext();
		});
};
