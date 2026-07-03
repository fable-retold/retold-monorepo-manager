const libAssert = require('assert');

const libDependencyGraph = require('../source/bulk/DependencyGraph.js');
const libPlannerRipple = require('../source/bulk/planners/Planner-Ripple.js');
const libPlannerBulk = require('../source/bulk/planners/Planner-Bulk.js');

function opsOf(pStep) { return pStep.Actions.map((pA) => (pA.Op)); }

suite('Planner-Ripple',
	() =>
	{
		// c depends on b depends on a  →  edges c→b, b→a
		let tmpGraph = new libDependencyGraph({ Nodes: [ 'a', 'b', 'c' ], Edges: [ { From: 'b', To: 'a' }, { From: 'c', To: 'b' } ] });

		test('plans the impact cone in dependency order (producers first)',
			() =>
			{
				let tmpPlan = libPlannerRipple.planRipple(tmpGraph, [ 'a' ], {});
				libAssert.strictEqual(tmpPlan.Type, 'ripple');
				libAssert.deepStrictEqual(tmpPlan.Steps.map((pS) => (pS.Target)), [ 'a', 'b', 'c' ]);
				libAssert.strictEqual(tmpPlan.Steps[0].Kind, 'producer');
				libAssert.strictEqual(tmpPlan.Steps[1].Kind, 'consumer');
			});

		test('root step publishes without update-dep; consumers update their in-cone dep',
			() =>
			{
				let tmpPlan = libPlannerRipple.planRipple(tmpGraph, [ 'a' ], {});
				// root a: no update-dep
				libAssert.ok(opsOf(tmpPlan.Steps[0]).indexOf('update-dep') < 0);
				libAssert.ok(opsOf(tmpPlan.Steps[0]).indexOf('bump-if-needed') >= 0);
				libAssert.ok(opsOf(tmpPlan.Steps[0]).indexOf('publish') >= 0);
				// consumer b: update-dep a
				let tmpUpdate = tmpPlan.Steps[1].Actions.find((pA) => (pA.Op === 'update-dep'));
				libAssert.ok(tmpUpdate);
				libAssert.strictEqual(tmpUpdate.Dep, 'a');
				// consumer c: update-dep b
				let tmpUpdateC = tmpPlan.Steps[2].Actions.find((pA) => (pA.Op === 'update-dep'));
				libAssert.strictEqual(tmpUpdateC.Dep, 'b');
			});

		test('every publish action is confirm-gated',
			() =>
			{
				let tmpPlan = libPlannerRipple.planRipple(tmpGraph, [ 'a' ], {});
				tmpPlan.Steps.forEach((pStep) =>
					{
						let tmpPublish = pStep.Actions.find((pA) => (pA.Op === 'publish'));
						libAssert.strictEqual(tmpPublish.RequiresConfirm, true);
					});
			});

		test('config toggles drop test/push/wait steps',
			() =>
			{
				let tmpPlan = libPlannerRipple.planRipple(tmpGraph, [ 'a' ], { RunTest: false, RunPush: false, WaitForIndex: false });
				let tmpConsumerOps = opsOf(tmpPlan.Steps[1]);
				libAssert.ok(tmpConsumerOps.indexOf('test') < 0);
				libAssert.ok(tmpConsumerOps.indexOf('push') < 0);
				libAssert.ok(tmpConsumerOps.indexOf('wait-for-index') < 0);
			});
	});

suite('Planner-Bulk',
	() =>
	{
		test('flat plan: same action chain per target',
			() =>
			{
				let tmpPlan = libPlannerBulk.planBulk([ 'x', 'y' ], [ 'pull' ], {});
				libAssert.strictEqual(tmpPlan.Type, 'bulk');
				libAssert.deepStrictEqual(tmpPlan.Steps.map((pS) => (pS.Target)), [ 'x', 'y' ]);
				libAssert.deepStrictEqual(opsOf(tmpPlan.Steps[0]), [ 'pull' ]);
			});

		test('bump carries the Kind param; ncu carries Apply/Scope',
			() =>
			{
				let tmpBump = libPlannerBulk.planBulk([ 'x' ], [ 'bump' ], { Kind: 'minor' });
				libAssert.strictEqual(tmpBump.Steps[0].Actions[0].Kind, 'minor');
				let tmpNcu = libPlannerBulk.planBulk([ 'x' ], [ 'ncu' ], { Apply: true, Scope: 'ecosystem' });
				libAssert.strictEqual(tmpNcu.Steps[0].Actions[0].Apply, true);
				libAssert.strictEqual(tmpNcu.Steps[0].Actions[0].Scope, 'ecosystem');
			});
	});
