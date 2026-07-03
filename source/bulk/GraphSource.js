/**
 * GraphSource — the ONLY module that couples the dependency graph to the filesystem + manifest.
 *
 * Walks the manifest's modules, reads each package.json, and emits { Nodes, Edges } for a pure
 * DependencyGraph. An edge exists iff a dependency's package name is a manifest module name AND passes
 * the loader's ecosystem-membership test (manifest-presence by default — the Phase 1 semantics).
 * Keeping this coupling in one place lets DependencyGraph stay pure and unit-testable.
 */
const libFS = require('fs');
const libPath = require('path');

const libDependencyGraph = require('./DependencyGraph.js');

const DEP_SECTIONS = [ 'dependencies', 'devDependencies' ];

function readJsonSafe(pPath)
{
	try { return JSON.parse(libFS.readFileSync(pPath, 'utf8')); }
	catch (pError) { return null; }
}

class GraphSource
{
	/**
	 * @param {object} pLoader - A loaded ManifestLoader.
	 * @returns {{ Nodes: object, Edges: Array }}
	 */
	static build(pLoader)
	{
		pLoader.ensureLoaded();
		let tmpModules = pLoader.getAllModules();

		let tmpNodes = {};
		let tmpNames = new Set();
		for (let i = 0; i < tmpModules.length; i++)
		{
			tmpNodes[tmpModules[i].Name] = { Name: tmpModules[i].Name, Group: tmpModules[i].GroupName };
			tmpNames.add(tmpModules[i].Name);
		}

		let tmpEdges = [];
		for (let i = 0; i < tmpModules.length; i++)
		{
			let tmpModule = tmpModules[i];
			let tmpPackage = readJsonSafe(libPath.join(tmpModule.AbsolutePath, 'package.json'));
			if (!tmpPackage) { continue; }

			for (let s = 0; s < DEP_SECTIONS.length; s++)
			{
				let tmpSection = tmpPackage[DEP_SECTIONS[s]];
				if (!tmpSection) { continue; }
				let tmpDepNames = Object.keys(tmpSection);
				for (let d = 0; d < tmpDepNames.length; d++)
				{
					let tmpDep = tmpDepNames[d];
					// Edge only to another module in this monorepo (and only if it counts as in-ecosystem).
					if (!tmpNames.has(tmpDep)) { continue; }
					if (!pLoader.isEcosystemDependency(tmpDep)) { continue; }
					let tmpRange = tmpSection[tmpDep];
					tmpEdges.push(
						{
							From: tmpModule.Name,
							To: tmpDep,
							Section: DEP_SECTIONS[s],
							Range: tmpRange,
							LocalLink: (typeof tmpRange === 'string') && (tmpRange.indexOf('file:') === 0 || tmpRange.indexOf('link:') === 0)
						});
				}
			}
		}

		return { Nodes: tmpNodes, Edges: tmpEdges };
	}

	/**
	 * Convenience: build a ready DependencyGraph from a loaded manifest.
	 * @param {object} pLoader
	 * @returns {libDependencyGraph}
	 */
	static buildGraph(pLoader)
	{
		return new libDependencyGraph(GraphSource.build(pLoader));
	}
}

module.exports = GraphSource;
