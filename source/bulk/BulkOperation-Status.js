/**
 * BulkOperation-Status — canonical run/step state vocabulary + helpers (ported from ultravisor's
 * self-contained Status module). Kept small and dependency-free so the UI can reuse it.
 */
const RUN_STATES =
	{
		QUEUED: 'Queued',
		RUNNING: 'Running',
		WAITING: 'Waiting',       // paused at a confirm gate
		COMPLETE: 'Complete',
		FAILED: 'Failed',
		CANCELLED: 'Cancelled'
	};

const STEP_STATES =
	{
		PENDING: 'Pending',
		RUNNING: 'Running',
		COMPLETE: 'Complete',
		ERROR: 'Error',
		SKIPPED: 'Skipped'
	};

const TERMINAL_RUN_STATES = new Set([ RUN_STATES.COMPLETE, RUN_STATES.FAILED, RUN_STATES.CANCELLED ]);

function isTerminal(pStatus)
{
	return TERMINAL_RUN_STATES.has(pStatus);
}

function isWaiting(pStatus)
{
	return pStatus === RUN_STATES.WAITING;
}

module.exports = { RUN_STATES, STEP_STATES, isTerminal, isWaiting };
