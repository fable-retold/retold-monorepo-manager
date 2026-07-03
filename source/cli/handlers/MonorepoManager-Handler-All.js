/**
 * Handler: `mm all <status|update|install|checkout>`.
 *
 * `status` is a read (the same scan as `mm status`). update/install/checkout are now sugar over the
 * bulk-operation engine (`mm bulk run <type> --all`) — one executor, with run history + retry.
 */
const libHandlerBulk = require('./MonorepoManager-Handler-Bulk.js');
const libHandlerStatus = require('./MonorepoManager-Handler-Status.js');

const ALL_TO_BULK = { update: 'update', install: 'install', checkout: 'checkout' };

async function all(pContext)
{
	let tmpArguments = pContext.Arguments || [];
	let tmpAction = tmpArguments[0];

	if (!tmpAction) { console.error('Usage: mm all <status|update|install|checkout>'); process.exitCode = 1; return; }
	if (tmpAction === 'status') { return libHandlerStatus.status(pContext); }

	if (!ALL_TO_BULK[tmpAction]) { console.error(`Unknown all action: ${tmpAction}. Expected status|update|install|checkout.`); process.exitCode = 1; return; }

	// The 'all'-targeted bulk operations run across every module (bounded-parallel).
	return libHandlerBulk.runFor(pContext, ALL_TO_BULK[tmpAction], []);
}

module.exports = { all };
