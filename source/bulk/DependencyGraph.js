/**
 * DependencyGraph — pure inter-module dependency graph math.
 *
 * Data-in, side-effect-free: constructed from { Nodes, Edges }, no filesystem, no manifest, no policy
 * (the retold `GROUP_ORDER` / `StopAtApps` / `file:`-link leaks are gone — inject `tieBreak`,
 * `edgeFilter`, and `stopWhen` instead). An edge `{ From, To }` means "From depends on To" (From is
 * the consumer/dependent, To is the producer/dependency).
 *
 * This is the "compute the graph" half of bulk operations — separate from planning and execution.
 */

// Default: ignore `file:`/`link:` workspace edges (they don't propagate published versions).
function defaultEdgeFilter(pEdge)
{
	return !pEdge.LocalLink;
}

function defaultTieBreak(pA, pB)
{
	return String(pA).localeCompare(String(pB));
}

class DependencyGraph
{
	/**
	 * @param {object} pOptions
	 * @param {object|Array} pOptions.Nodes - { name: { Name, Group? } } map, or an array of names / {Name,Group}.
	 * @param {Array} pOptions.Edges - [{ From, To, Section?, Range?, LocalLink? }] (From depends on To).
	 */
	constructor(pOptions)
	{
		let tmpOptions = pOptions || {};

		this.nodes = new Map();
		let tmpNodes = tmpOptions.Nodes || {};
		if (Array.isArray(tmpNodes))
		{
			for (let i = 0; i < tmpNodes.length; i++)
			{
				let tmpNode = tmpNodes[i];
				let tmpName = (typeof tmpNode === 'string') ? tmpNode : tmpNode.Name;
				this.nodes.set(tmpName, { Name: tmpName, Group: (typeof tmpNode === 'object' && tmpNode.Group) || null });
			}
		}
		else
		{
			Object.keys(tmpNodes).forEach((pName) =>
				{
					this.nodes.set(pName, { Name: pName, Group: (tmpNodes[pName] && tmpNodes[pName].Group) || null });
				});
		}

		this.edges = (tmpOptions.Edges || []).slice();

		// Adjacency indexes.
		this._outEdges = new Map(); // name -> [edge]  (name's dependencies: edges where From === name)
		this._inEdges = new Map();  // name -> [edge]  (name's dependents: edges where To === name)
		for (let i = 0; i < this.edges.length; i++)
		{
			let tmpEdge = this.edges[i];
			if (!this._outEdges.has(tmpEdge.From)) { this._outEdges.set(tmpEdge.From, []); }
			this._outEdges.get(tmpEdge.From).push(tmpEdge);
			if (!this._inEdges.has(tmpEdge.To)) { this._inEdges.set(tmpEdge.To, []); }
			this._inEdges.get(tmpEdge.To).push(tmpEdge);
		}
	}

	nodeNames()
	{
		return Array.from(this.nodes.keys());
	}

	/** Names this node directly depends on. */
	dependenciesOf(pName)
	{
		return (this._outEdges.get(pName) || []).map((pEdge) => (pEdge.To));
	}

	/** Names that directly depend on this node. */
	dependentsOf(pName)
	{
		return (this._inEdges.get(pName) || []).map((pEdge) => (pEdge.From));
	}

	/**
	 * Blast radius: every node transitively depending on any of pRoots (i.e. what must rebuild/
	 * republish if a root changes). Excludes the roots themselves.
	 * @param {Array<string>} pRoots
	 * @param {object} [pOptions] - { edgeFilter, stopWhen }
	 * @returns {Array<string>}
	 */
	impactOf(pRoots, pOptions)
	{
		let tmpOptions = pOptions || {};
		let tmpEdgeFilter = tmpOptions.edgeFilter || defaultEdgeFilter;
		let tmpStopWhen = tmpOptions.stopWhen || (() => false);

		let tmpVisited = new Set(pRoots);
		let tmpQueue = pRoots.slice();
		let tmpResult = [];

		while (tmpQueue.length > 0)
		{
			let tmpName = tmpQueue.shift();
			let tmpDependentEdges = this._inEdges.get(tmpName) || [];
			for (let i = 0; i < tmpDependentEdges.length; i++)
			{
				let tmpEdge = tmpDependentEdges[i];
				if (!tmpEdgeFilter(tmpEdge)) { continue; }
				let tmpDependent = tmpEdge.From;
				if (tmpVisited.has(tmpDependent)) { continue; }
				if (tmpStopWhen(this.nodes.get(tmpDependent) || { Name: tmpDependent })) { continue; }
				tmpVisited.add(tmpDependent);
				tmpResult.push(tmpDependent);
				tmpQueue.push(tmpDependent);
			}
		}
		return tmpResult;
	}

	/**
	 * Topological order over a subset: dependencies (producers) before dependents (consumers).
	 * Deterministic — ready nodes are ordered by `tieBreak` (default: name). Nodes caught in a cycle
	 * are appended deterministically at the end (never silently dropped).
	 * @param {Array<string>} pSubset - names to order (defaults to all nodes).
	 * @param {object} [pOptions] - { tieBreak, edgeFilter }
	 * @returns {Array<string>}
	 */
	topoOrder(pSubset, pOptions)
	{
		let tmpOptions = pOptions || {};
		let tmpTieBreak = tmpOptions.tieBreak || defaultTieBreak;
		let tmpEdgeFilter = tmpOptions.edgeFilter || defaultEdgeFilter;

		let tmpSet = new Set(pSubset && pSubset.length ? pSubset : this.nodeNames());

		// In-degree = number of a node's own dependencies that are inside the subset.
		let tmpInDegree = new Map();
		tmpSet.forEach((pName) => tmpInDegree.set(pName, 0));
		tmpSet.forEach((pName) =>
			{
				let tmpDependencyEdges = this._outEdges.get(pName) || [];
				let tmpCount = 0;
				for (let i = 0; i < tmpDependencyEdges.length; i++)
				{
					let tmpEdge = tmpDependencyEdges[i];
					if (tmpSet.has(tmpEdge.To) && tmpEdgeFilter(tmpEdge)) { tmpCount++; }
				}
				tmpInDegree.set(pName, tmpCount);
			});

		let tmpReady = [];
		tmpInDegree.forEach((pDegree, pName) => { if (pDegree === 0) { tmpReady.push(pName); } });
		tmpReady.sort(tmpTieBreak);

		let tmpOrder = [];
		let tmpEmitted = new Set();
		while (tmpReady.length > 0)
		{
			let tmpName = tmpReady.shift();
			tmpOrder.push(tmpName);
			tmpEmitted.add(tmpName);

			// Relax this node's dependents (edges where To === name, From inside subset).
			let tmpDependentEdges = this._inEdges.get(tmpName) || [];
			let tmpNewlyReady = [];
			for (let i = 0; i < tmpDependentEdges.length; i++)
			{
				let tmpEdge = tmpDependentEdges[i];
				if (!tmpSet.has(tmpEdge.From) || !tmpEdgeFilter(tmpEdge)) { continue; }
				let tmpDegree = tmpInDegree.get(tmpEdge.From) - 1;
				tmpInDegree.set(tmpEdge.From, tmpDegree);
				if (tmpDegree === 0) { tmpNewlyReady.push(tmpEdge.From); }
			}
			if (tmpNewlyReady.length > 0)
			{
				tmpReady = tmpReady.concat(tmpNewlyReady);
				tmpReady.sort(tmpTieBreak);
			}
		}

		// Cycle fallback: any subset node never emitted is in a cycle — append deterministically.
		let tmpLeftover = [];
		tmpSet.forEach((pName) => { if (!tmpEmitted.has(pName)) { tmpLeftover.push(pName); } });
		tmpLeftover.sort(tmpTieBreak);
		return tmpOrder.concat(tmpLeftover);
	}

	/**
	 * Nodes that are members of an actual dependency cycle (Tarjan's strongly-connected components:
	 * any SCC of size > 1, or a self-dependency). Nodes merely downstream of a cycle are NOT included.
	 * @returns {Array<string>}
	 */
	findCycles()
	{
		let tmpSelf = this;
		let tmpIndex = 0;
		let tmpStack = [];
		let tmpOnStack = new Set();
		let tmpIndices = new Map();
		let tmpLowLink = new Map();
		let tmpComponents = [];

		function strongConnect(pNode)
		{
			tmpIndices.set(pNode, tmpIndex);
			tmpLowLink.set(pNode, tmpIndex);
			tmpIndex++;
			tmpStack.push(pNode);
			tmpOnStack.add(pNode);

			let tmpDependencyEdges = (tmpSelf._outEdges.get(pNode) || []).filter(defaultEdgeFilter);
			for (let i = 0; i < tmpDependencyEdges.length; i++)
			{
				let tmpTo = tmpDependencyEdges[i].To;
				if (!tmpSelf.nodes.has(tmpTo)) { continue; }
				if (!tmpIndices.has(tmpTo))
				{
					strongConnect(tmpTo);
					tmpLowLink.set(pNode, Math.min(tmpLowLink.get(pNode), tmpLowLink.get(tmpTo)));
				}
				else if (tmpOnStack.has(tmpTo))
				{
					tmpLowLink.set(pNode, Math.min(tmpLowLink.get(pNode), tmpIndices.get(tmpTo)));
				}
			}

			if (tmpLowLink.get(pNode) === tmpIndices.get(pNode))
			{
				let tmpComponent = [];
				let tmpPopped;
				do
				{
					tmpPopped = tmpStack.pop();
					tmpOnStack.delete(tmpPopped);
					tmpComponent.push(tmpPopped);
				} while (tmpPopped !== pNode);
				tmpComponents.push(tmpComponent);
			}
		}

		let tmpNames = this.nodeNames();
		for (let i = 0; i < tmpNames.length; i++)
		{
			if (!tmpIndices.has(tmpNames[i])) { strongConnect(tmpNames[i]); }
		}

		let tmpResult = [];
		for (let i = 0; i < tmpComponents.length; i++)
		{
			let tmpComponent = tmpComponents[i];
			if (tmpComponent.length > 1)
			{
				tmpResult = tmpResult.concat(tmpComponent);
			}
			else
			{
				let tmpNode = tmpComponent[0];
				if ((this._outEdges.get(tmpNode) || []).some((pEdge) => (pEdge.To === tmpNode))) { tmpResult.push(tmpNode); }
			}
		}
		return tmpResult;
	}

	/** A { Nodes, Edges } slice containing only the named nodes and edges between them. */
	subgraph(pNames)
	{
		let tmpSet = new Set(pNames);
		let tmpNodes = {};
		tmpSet.forEach((pName) => { if (this.nodes.has(pName)) { tmpNodes[pName] = this.nodes.get(pName); } });
		let tmpEdges = this.edges.filter((pEdge) => (tmpSet.has(pEdge.From) && tmpSet.has(pEdge.To)));
		return { Nodes: tmpNodes, Edges: tmpEdges };
	}

	/** Shape for a client graph visualization. */
	toVisualizationJSON()
	{
		let tmpNodes = [];
		this.nodes.forEach((pNode) => tmpNodes.push({ Name: pNode.Name, Group: pNode.Group }));
		let tmpEdges = this.edges.map((pEdge) => ({ From: pEdge.From, To: pEdge.To, Section: pEdge.Section, Range: pEdge.Range }));
		return { Nodes: tmpNodes, Edges: tmpEdges };
	}
}

module.exports = DependencyGraph;
module.exports.defaultEdgeFilter = defaultEdgeFilter;
module.exports.defaultTieBreak = defaultTieBreak;
