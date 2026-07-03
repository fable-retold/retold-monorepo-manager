const libAssert = require('assert');

const libDependencyGraph = require('../source/bulk/DependencyGraph.js');

// Edge { From, To } === "From depends on To".
function graph(pNodes, pEdges)
{
	return new libDependencyGraph({ Nodes: pNodes, Edges: pEdges.map((pE) => ({ From: pE[0], To: pE[1] })) });
}

suite('DependencyGraph',
	() =>
	{
		test('dependenciesOf / dependentsOf on a chain a→b→c',
			() =>
			{
				let tmpGraph = graph([ 'a', 'b', 'c' ], [ [ 'a', 'b' ], [ 'b', 'c' ] ]);
				libAssert.deepStrictEqual(tmpGraph.dependenciesOf('a'), [ 'b' ]);
				libAssert.deepStrictEqual(tmpGraph.dependenciesOf('c'), []);
				libAssert.deepStrictEqual(tmpGraph.dependentsOf('c'), [ 'b' ]);
				libAssert.deepStrictEqual(tmpGraph.dependentsOf('a'), []);
			});

		test('topoOrder puts producers before consumers (chain)',
			() =>
			{
				let tmpGraph = graph([ 'a', 'b', 'c' ], [ [ 'a', 'b' ], [ 'b', 'c' ] ]);
				libAssert.deepStrictEqual(tmpGraph.topoOrder([ 'a', 'b', 'c' ], {}), [ 'c', 'b', 'a' ]);
			});

		test('impactOf is the transitive dependents (blast radius)',
			() =>
			{
				let tmpGraph = graph([ 'a', 'b', 'c' ], [ [ 'a', 'b' ], [ 'b', 'c' ] ]);
				// changing c impacts b then a
				libAssert.deepStrictEqual(tmpGraph.impactOf([ 'c' ], {}).sort(), [ 'a', 'b' ]);
				libAssert.deepStrictEqual(tmpGraph.impactOf([ 'a' ], {}), []);
			});

		test('diamond: d→b,c ; b,c→a — topo + impact',
			() =>
			{
				let tmpGraph = graph([ 'a', 'b', 'c', 'd' ], [ [ 'd', 'b' ], [ 'd', 'c' ], [ 'b', 'a' ], [ 'c', 'a' ] ]);
				libAssert.deepStrictEqual(tmpGraph.topoOrder([ 'a', 'b', 'c', 'd' ], {}), [ 'a', 'b', 'c', 'd' ]);
				libAssert.deepStrictEqual(tmpGraph.impactOf([ 'a' ], {}).sort(), [ 'b', 'c', 'd' ]);
			});

		test('edgeFilter skips file: workspace links by default',
			() =>
			{
				let tmpGraph = new libDependencyGraph(
					{
						Nodes: [ 'a', 'b' ],
						Edges: [ { From: 'a', To: 'b', LocalLink: true } ]
					});
				// a's dependency on b is a file: link → not counted for impact/topo
				libAssert.deepStrictEqual(tmpGraph.impactOf([ 'b' ], {}), []);
			});

		test('findCycles surfaces cyclic nodes and topoOrder still returns them',
			() =>
			{
				let tmpGraph = graph([ 'x', 'y', 'z' ], [ [ 'x', 'y' ], [ 'y', 'x' ], [ 'z', 'x' ] ]);
				libAssert.deepStrictEqual(tmpGraph.findCycles().sort(), [ 'x', 'y' ]);
				// z is acyclic (depends on x); order still contains all three, no crash
				let tmpOrder = tmpGraph.topoOrder([ 'x', 'y', 'z' ], {});
				libAssert.strictEqual(tmpOrder.length, 3);
			});

		test('toVisualizationJSON + subgraph shapes',
			() =>
			{
				let tmpGraph = new libDependencyGraph(
					{
						Nodes: { a: { Group: 'G1' }, b: { Group: 'G2' } },
						Edges: [ { From: 'a', To: 'b', Section: 'dependencies', Range: '^1.0.0' } ]
					});
				let tmpViz = tmpGraph.toVisualizationJSON();
				libAssert.strictEqual(tmpViz.Nodes.length, 2);
				libAssert.strictEqual(tmpViz.Edges[0].Range, '^1.0.0');
				let tmpSub = tmpGraph.subgraph([ 'a' ]);
				libAssert.deepStrictEqual(Object.keys(tmpSub.Nodes), [ 'a' ]);
				libAssert.strictEqual(tmpSub.Edges.length, 0);
			});
	});
