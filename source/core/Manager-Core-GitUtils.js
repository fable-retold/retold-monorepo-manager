/**
 * Retold Monorepo Manager -- Git Utilities
 *
 * Small, transport-agnostic git helpers shared across the tool. These are the
 * fork/PR-free salvage of the former GitHub-PR helper: a git remote URL parser
 * and a synchronous `git` capture wrapper. Nothing here shells out to the `gh`
 * CLI, assumes an `upstream` remote, or knows anything about the fork → upstream
 * pull-request workflow.
 *
 * All synchronous (spawnSync) — they shell out to `git`.
 */

const libChildProcess = require('child_process');

//
// Convert a git remote URL into { Owner, Repo }. Handles both
//   https://github.com/owner/repo[.git]   and   git@github.com:owner/repo[.git]
// Returns null for empty / unrecognized input.
//
function parseGithubUrl(pUrl)
{
	if (!pUrl) return null;
	let tmpMatch = pUrl.match(/^(?:https?:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/.]+?)(?:\.git)?$/);
	if (!tmpMatch) return null;
	return { Owner: tmpMatch[1], Repo: tmpMatch[2] };
}

function gitCapture(pArgs, pCwd)
{
	let tmpResult = libChildProcess.spawnSync('git', pArgs, { cwd: pCwd, encoding: 'utf8' });
	return { Status: tmpResult.status, Stdout: (tmpResult.stdout || '').trim(), Stderr: (tmpResult.stderr || '').trim() };
}

module.exports =
	{
		parseGithubUrl,
		gitCapture,
	};
