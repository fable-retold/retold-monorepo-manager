/**
 * BulkOperation-StateManager — the three-tier state bag (ultravisor's Global / Operation / Task
 * scopes), kept minimal (dotted paths, no Manyfest/template dependency). This is how one step's
 * output reaches a later step — e.g. `update-dep` records the version it resolved so the `commit`
 * step can name it in the message.
 *
 * Addresses:
 *   Global.<path>            — shared across everything
 *   Operation.<path>         — shared across all targets in this run
 *   Task.<target>.<path>     — one target's own outputs
 */
function getPath(pRoot, pParts)
{
	let tmpNode = pRoot;
	for (let i = 0; i < pParts.length; i++)
	{
		if (tmpNode === null || tmpNode === undefined) { return undefined; }
		tmpNode = tmpNode[pParts[i]];
	}
	return tmpNode;
}

function setPath(pRoot, pParts, pValue)
{
	let tmpNode = pRoot;
	for (let i = 0; i < pParts.length - 1; i++)
	{
		if (typeof tmpNode[pParts[i]] !== 'object' || tmpNode[pParts[i]] === null) { tmpNode[pParts[i]] = {}; }
		tmpNode = tmpNode[pParts[i]];
	}
	tmpNode[pParts[pParts.length - 1]] = pValue;
}

class StateManager
{
	/**
	 * @param {object} pState - the run's state object { Global, Operation, Tasks }.
	 */
	constructor(pState)
	{
		this.state = pState || { Global: {}, Operation: {}, Tasks: {} };
		if (!this.state.Global) { this.state.Global = {}; }
		if (!this.state.Operation) { this.state.Operation = {}; }
		if (!this.state.Tasks) { this.state.Tasks = {}; }
	}

	get(pAddress)
	{
		let tmpParts = String(pAddress).split('.');
		let tmpScope = tmpParts.shift();
		if (tmpScope === 'Global') { return getPath(this.state.Global, tmpParts); }
		if (tmpScope === 'Operation') { return getPath(this.state.Operation, tmpParts); }
		if (tmpScope === 'Task') { return getPath(this.state.Tasks, tmpParts); }
		return undefined;
	}

	set(pAddress, pValue)
	{
		let tmpParts = String(pAddress).split('.');
		let tmpScope = tmpParts.shift();
		if (tmpScope === 'Global') { setPath(this.state.Global, tmpParts, pValue); }
		else if (tmpScope === 'Operation') { setPath(this.state.Operation, tmpParts, pValue); }
		else if (tmpScope === 'Task') { setPath(this.state.Tasks, tmpParts, pValue); }
		return this;
	}

	/** A scoped accessor handed to a task's handler for one target. */
	forTarget(pTarget)
	{
		let tmpSelf = this;
		return {
			get: (pKey) => (tmpSelf.get('Task.' + pTarget + '.' + pKey)),
			set: (pKey, pValue) => (tmpSelf.set('Task.' + pTarget + '.' + pKey, pValue)),
			getOperation: (pKey) => (tmpSelf.get('Operation.' + pKey)),
			setOperation: (pKey, pValue) => (tmpSelf.set('Operation.' + pKey, pValue)),
			all: () => (tmpSelf.state.Tasks[pTarget] || {})
		};
	}
}

module.exports = StateManager;
