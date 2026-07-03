/**
 * MonorepoManager-ScanState — origin-only status classifier (no view).
 *
 * The server computes each scan entry's `NextAction` (one of commit/pull/push/in-sync); this maps
 * that code to a label + badge and answers "needs action?". Fork action codes (pull-fork/
 * sync-upstream/create-pr) do not exist here — the tool is origin-only.
 */
const ACTION_META =
	{
		'commit':  { Label: 'commit', Badge: 'commit', Tip: 'Uncommitted changes' },
		'pull':    { Label: 'pull',   Badge: 'pull',   Tip: 'Behind origin' },
		'push':    { Label: 'push',   Badge: 'push',   Tip: 'Ahead of origin' },
		'in-sync': { Label: 'in sync', Badge: null,    Tip: 'Up to date' }
	};

const ACTION_RANK = { 'commit': 1, 'pull': 2, 'push': 3, 'in-sync': 99 };

function nextAction(pEntry)
{
	return (pEntry && pEntry.NextAction) || 'in-sync';
}

function actionMeta(pEntry)
{
	return ACTION_META[nextAction(pEntry)] || ACTION_META['in-sync'];
}

function needsAction(pEntry)
{
	return nextAction(pEntry) !== 'in-sync';
}

function badgeState(pEntry)
{
	return actionMeta(pEntry).Badge;
}

function actionLabel(pEntry)
{
	return actionMeta(pEntry).Label;
}

function actionRank(pEntry)
{
	return ACTION_RANK[nextAction(pEntry)] || 50;
}

module.exports = { ACTION_META, ACTION_RANK, nextAction, actionMeta, needsAction, badgeState, actionLabel, actionRank };
