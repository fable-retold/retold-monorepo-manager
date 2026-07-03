/**
 * BulkOperation-TaskRegistry — the config-driven task-type registry (ultravisor's
 * registerTaskTypeFromConfig pattern). A task type is a plain object:
 *
 *   { Definition: { Op, Label, Description?, RequiresConfirm?, Validator? },
 *     Execute: async (pContext, pStep, pAction) => ({ Outputs?, StateWrites?, Log?, Skip? }) }
 *
 * Every planner emits `Op` names into this shared vocabulary; the engine dispatches on `Op`.
 */
class TaskRegistry
{
	constructor()
	{
		this._types = new Map();
	}

	register(pTaskType)
	{
		if (!pTaskType || !pTaskType.Definition || !pTaskType.Definition.Op)
		{
			throw new Error('TaskRegistry.register: a task type needs Definition.Op');
		}
		this._types.set(pTaskType.Definition.Op, pTaskType);
		return this;
	}

	registerAll(pTaskTypes)
	{
		(pTaskTypes || []).forEach((pTaskType) => this.register(pTaskType));
		return this;
	}

	get(pOp)
	{
		return this._types.get(pOp) || null;
	}

	has(pOp)
	{
		return this._types.has(pOp);
	}

	definitions()
	{
		return Array.from(this._types.values()).map((pTaskType) => (pTaskType.Definition));
	}
}

module.exports = TaskRegistry;
