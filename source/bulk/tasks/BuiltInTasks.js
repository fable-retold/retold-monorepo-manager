/**
 * BuiltInTasks — the task-type vocabulary every planner emits into. Each is
 * { Definition:{Op,Label,RequiresConfirm?,Validator?}, Execute:async(ctx, step, action) }.
 *
 * Reusable (any bulk op): preflight-clean-tree, install, test, build, commit, commit-final, bump,
 * push, publish (confirm-gated), pull, checkout, ncu, regen-docs, deps-align.
 * Ripple-ish: update-dep (resolve-at-run version + atomic rewrite), bump-if-needed, wait-for-index.
 */
const libFS = require('fs');
const libPath = require('path');

const libCommitComposer = require('../../core/Manager-Core-CommitComposer.js');
const libGitUtils = require('../../core/Manager-Core-GitUtils.js');
const libDepAligner = require('../../core/Manager-Core-DepAligner.js');

function readPackage(pModulePath)
{
	try { return JSON.parse(libFS.readFileSync(libPath.join(pModulePath, 'package.json'), 'utf8')); }
	catch (pError) { return null; }
}

function detectIndent(pText)
{
	let tmpMatch = pText.match(/\n([\t ]+)"/);
	return tmpMatch ? tmpMatch[1] : '\t';
}

function atomicWrite(pPath, pContent)
{
	let tmpTemp = `${pPath}.tmp-${process.pid}`;
	libFS.writeFileSync(tmpTemp, pContent, 'utf8');
	libFS.renameSync(tmpTemp, pPath);
}

function cloneUrl(pModule, pConfig)
{
	if (pModule.Repository && pModule.Repository.Url) { return pModule.Repository.Url; }
	if (typeof pModule.GitHub === 'string' && pModule.GitHub.length > 0) { return pModule.GitHub; }
	if (pConfig.Org && pConfig.GitTemplate) { return pConfig.GitTemplate.split('{org}').join(pConfig.Org).split('{name}').join(pModule.Name); }
	return null;
}

// Run a shell command; throw on non-zero unless pSoft.
async function shell(pContext, pShellOptions, pSoft)
{
	let tmpCode = await pContext.RunShell(pShellOptions);
	if (tmpCode !== 0 && !pSoft) { throw new Error(`${pShellOptions.Label || pShellOptions.Command} failed (exit ${tmpCode})`); }
	return tmpCode;
}

const TASKS =
[
	// ─── guards ───────────────────────────────────────────────────
	{
		Definition: { Op: 'preflight-clean-tree', Label: 'preflight' },
		Execute: async (pContext) =>
		{
			let tmpCapture = libGitUtils.gitCapture([ 'status', '--porcelain' ], pContext.Module.AbsolutePath);
			if (tmpCapture.Stdout && tmpCapture.Stdout.trim().length > 0) { throw new Error('working tree is not clean'); }
			pContext.Log('preflight: working tree clean');
			return {};
		}
	},

	// ─── npm lifecycle ────────────────────────────────────────────
	{ Definition: { Op: 'install', Label: 'install' }, Execute: async (pContext) => { await shell(pContext, { Command: 'npm', Args: [ 'install' ], Cwd: pContext.Module.AbsolutePath, Label: 'install ' + pContext.Target }); return {}; } },
	{ Definition: { Op: 'test', Label: 'test' }, Execute: async (pContext) => { await shell(pContext, { Command: 'npm', Args: [ 'test' ], Cwd: pContext.Module.AbsolutePath, Label: 'test ' + pContext.Target }); return {}; } },
	{ Definition: { Op: 'build', Label: 'build' }, Execute: async (pContext) => { await shell(pContext, { Command: 'npm', Args: [ 'run', 'build' ], Cwd: pContext.Module.AbsolutePath, Label: 'build ' + pContext.Target }); return {}; } },

	{
		Definition: { Op: 'bump', Label: 'bump version' },
		Execute: async (pContext, pStep, pAction) =>
		{
			let tmpKind = pAction.Kind || 'patch';
			await shell(pContext, { Command: 'npm', Args: [ 'version', tmpKind, '--no-git-tag-version' ], Cwd: pContext.Module.AbsolutePath, Label: 'version ' + pContext.Target });
			let tmpPackage = readPackage(pContext.Module.AbsolutePath);
			return { Outputs: { version: tmpPackage && tmpPackage.version } };
		}
	},

	{
		Definition: { Op: 'bump-if-needed', Label: 'bump if needed' },
		Execute: async (pContext) =>
		{
			let tmpPackage = readPackage(pContext.Module.AbsolutePath);
			if (!tmpPackage || !tmpPackage.version || !tmpPackage.name) { throw new Error('no package version'); }
			let tmpPublished = null;
			try { tmpPublished = pContext.Introspector.fetchPublishedVersionSync(tmpPackage.name, { Timeout: 10000 }); }
			catch (pError) { /* treat as unpublished */ }
			if (!tmpPublished) { pContext.Log(`bump-if-needed: ${tmpPackage.name} unpublished — will publish ${tmpPackage.version}`); return {}; }
			let tmpCompare = libDepAligner.compareSemver(tmpPackage.version, tmpPublished);
			if (tmpCompare > 0) { pContext.Log(`bump-if-needed: local ${tmpPackage.version} ahead of npm ${tmpPublished} — keeping`); return {}; }
			if (tmpCompare === 0)
			{
				pContext.Log(`bump-if-needed: local == npm (${tmpPackage.version}) — bumping patch`);
				await shell(pContext, { Command: 'npm', Args: [ 'version', 'patch', '--no-git-tag-version' ], Cwd: pContext.Module.AbsolutePath, Label: 'version ' + pContext.Target });
				return {};
			}
			throw new Error(`local ${tmpPackage.version} is BEHIND npm ${tmpPublished} — resolve manually`);
		}
	},

	{
		Definition:
		{
			Op: 'publish', Label: 'publish', RequiresConfirm: true,
			Validator: async (pContext) =>
			{
				if (!pContext.Validator) { return { Ok: true, OkToPublish: true, PreviewHash: 'no-validator', Problems: [] }; }
				return pContext.Validator.validate(pContext.Target, {});
			}
		},
		Execute: async (pContext) => { await shell(pContext, { Command: 'npm', Args: [ 'publish' ], Cwd: pContext.Module.AbsolutePath, Label: 'publish ' + pContext.Target }); return {}; }
	},

	{
		Definition: { Op: 'wait-for-index', Label: 'wait for npm index' },
		Execute: async (pContext) =>
		{
			let tmpPackage = readPackage(pContext.Module.AbsolutePath);
			if (!tmpPackage || !tmpPackage.name || !tmpPackage.version) { return { Skip: true }; }
			pContext.Log(`wait-for-index: waiting for npm to serve ${tmpPackage.name}@${tmpPackage.version}…`);
			let tmpDeadline = Date.now() + 120000;
			while (Date.now() < tmpDeadline)
			{
				try
				{
					if (pContext.Introspector.clearNpmVersionCache) { pContext.Introspector.clearNpmVersionCache(); }
					let tmpPublished = await pContext.Introspector.fetchPublishedVersion(tmpPackage.name, { Timeout: 8000 });
					if (tmpPublished === tmpPackage.version) { pContext.Log(`wait-for-index: ${tmpPackage.name}@${tmpPackage.version} is live`); return {}; }
				}
				catch (pError) { /* keep polling */ }
				await new Promise((pResolve) => setTimeout(pResolve, 2500));
			}
			pContext.Log(`wait-for-index: timed out (npm lag) — continuing`, 'err');
			return {};
		}
	},

	// ─── git ──────────────────────────────────────────────────────
	{
		Definition: { Op: 'update-dep', Label: 'update dependency' },
		Execute: async (pContext, pStep, pAction) =>
		{
			let tmpDep = pAction.Dep;
			let tmpSection = pAction.Section || 'dependencies';
			let tmpPrefix = pAction.RangePrefix || '^';

			// Resolve the dependency's CURRENT on-disk version (it may have just been bumped earlier
			// in this ripple) — the resolve-at-run contract.
			let tmpDepModule = pContext.Loader.getModule(tmpDep);
			let tmpDepPackage = tmpDepModule ? readPackage(tmpDepModule.AbsolutePath) : null;
			let tmpVersion = tmpDepPackage && tmpDepPackage.version;
			if (!tmpVersion) { pContext.Log(`update-dep: could not resolve version for ${tmpDep}`, 'err'); return { Skip: true }; }

			let tmpDesired = tmpPrefix + tmpVersion;
			let tmpPackagePath = libPath.join(pContext.Module.AbsolutePath, 'package.json');
			let tmpText = libFS.readFileSync(tmpPackagePath, 'utf8');
			let tmpPackage = JSON.parse(tmpText);
			if (!tmpPackage[tmpSection]) { tmpPackage[tmpSection] = {}; }
			let tmpOld = tmpPackage[tmpSection][tmpDep];
			if (tmpOld === tmpDesired) { pContext.Log(`update-dep: ${tmpDep} already ${tmpDesired}`); return { Skip: true }; }
			tmpPackage[tmpSection][tmpDep] = tmpDesired;
			atomicWrite(tmpPackagePath, JSON.stringify(tmpPackage, null, detectIndent(tmpText)) + '\n');
			pContext.Log(`update-dep: ${tmpDep} ${tmpOld || '(none)'} → ${tmpDesired}`);

			let tmpResolved = pContext.State.get('resolvedDeps') || [];
			tmpResolved.push(`${tmpDep}@${tmpVersion}`);
			pContext.State.set('resolvedDeps', tmpResolved);
			return {};
		}
	},

	{
		Definition: { Op: 'commit', Label: 'commit' },
		Execute: async (pContext, pStep, pAction) =>
		{
			let tmpResolved = pContext.State.get('resolvedDeps') || [];
			let tmpMessage = pAction.Message || (tmpResolved.length ? `chore: bump deps (${tmpResolved.join(', ')})` : 'chore: bulk update');
			let tmpValidation = libCommitComposer.validateMessage(tmpMessage);
			if (!tmpValidation.Ok) { throw new Error('invalid commit message: ' + tmpValidation.Problems.join('; ')); }
			let tmpBuilt = libCommitComposer.buildCommitArgs(tmpMessage, { AddAll: true });
			let tmpCode = await pContext.RunShell({ Command: tmpBuilt.Command, Args: tmpBuilt.Args, Cwd: pContext.Module.AbsolutePath, Label: 'commit ' + pContext.Target });
			if (tmpCode !== 0) { pContext.Log('commit: nothing to commit (or failed) — continuing'); }
			return {};
		}
	},

	{
		Definition: { Op: 'commit-final', Label: 'commit built artifacts' },
		Execute: async (pContext) =>
		{
			await shell(pContext, { Command: 'git', Args: [ 'add', '-A' ], Cwd: pContext.Module.AbsolutePath, Label: 'add ' + pContext.Target }, true);
			let tmpBuilt = libCommitComposer.buildCommitArgs('chore: publish', { AddAll: false });
			let tmpCode = await pContext.RunShell({ Command: tmpBuilt.Command, Args: tmpBuilt.Args, Cwd: pContext.Module.AbsolutePath, Label: 'commit-final ' + pContext.Target });
			if (tmpCode !== 0) { pContext.Log('commit-final: nothing to commit — continuing'); }
			return {};
		}
	},

	{ Definition: { Op: 'push', Label: 'push' }, Execute: async (pContext) => { let tmpCode = await pContext.RunShell({ Command: 'git', Args: [ 'push' ], Cwd: pContext.Module.AbsolutePath, Label: 'push ' + pContext.Target }); if (tmpCode !== 0) { pContext.Log('push: exit ' + tmpCode + ' — continuing', 'err'); } return {}; } },

	{
		Definition: { Op: 'pull', Label: 'pull' },
		Execute: async (pContext) =>
		{
			let tmpRemote = pContext.Loader.getConfig().GitRemote || 'origin';
			await shell(pContext, { Command: 'git', Args: [ 'pull', '--rebase', tmpRemote ], Cwd: pContext.Module.AbsolutePath, Label: 'pull ' + pContext.Target });
			return {};
		}
	},

	{
		Definition: { Op: 'checkout', Label: 'clone if missing' },
		Execute: async (pContext) =>
		{
			let tmpModule = pContext.Module;
			if (libFS.existsSync(libPath.join(tmpModule.AbsolutePath, '.git'))) { pContext.Log('checkout: already present'); return { Skip: true }; }
			let tmpUrl = cloneUrl(tmpModule, pContext.Loader.getConfig());
			if (!tmpUrl) { throw new Error('no clone URL (set Org/GitTemplate or the entry GitHub)'); }
			await shell(pContext, { Command: 'git', Args: [ 'clone', tmpUrl, tmpModule.AbsolutePath ], Cwd: pContext.Loader.getRepoRoot(), Label: 'clone ' + pContext.Target });
			return {};
		}
	},

	// ─── deps / docs ──────────────────────────────────────────────
	{
		Definition: { Op: 'ncu', Label: 'ncu' },
		Execute: async (pContext, pStep, pAction) =>
		{
			let tmpArgs = [ 'npm-check-updates' ];
			if (pAction.Apply) { tmpArgs.push('-u'); }
			if (pAction.Scope === 'ecosystem') { let tmpNames = pContext.Loader.getAllModuleNames(); if (tmpNames.length) { tmpArgs.push('--filter', tmpNames.join(',')); } }
			if (pAction.Apply)
			{
				await shell(pContext, { Cwd: pContext.Module.AbsolutePath, AbortOnError: true, Steps: [ { Command: 'npx', Args: tmpArgs, Label: 'ncu -u' }, { Command: 'npm', Args: [ 'install' ], Label: 'install' } ] });
			}
			else
			{
				await shell(pContext, { Command: 'npx', Args: tmpArgs, Cwd: pContext.Module.AbsolutePath, Label: 'ncu ' + pContext.Target });
			}
			return {};
		}
	},

	{
		Definition: { Op: 'regen-docs', Label: 'regenerate docs' },
		Execute: async (pContext) =>
		{
			let tmpConfig = pContext.Loader.getConfig();
			let tmpEngine = tmpConfig.Docs && tmpConfig.Docs.Engine;
			if (!tmpEngine) { pContext.Log('regen-docs: no Docs.Engine configured — skipping'); return { Skip: true }; }
			let tmpParts = String(tmpEngine).split(/\s+/);
			let tmpCode = await pContext.RunShell({ Command: tmpParts[0], Args: tmpParts.slice(1), Cwd: pContext.Module.AbsolutePath, Label: 'docs ' + pContext.Target });
			if (tmpCode !== 0) { pContext.Log('regen-docs: exit ' + tmpCode, 'err'); }
			return {};
		}
	},

	{
		Definition: { Op: 'deps-align', Label: 'align ecosystem deps' },
		Execute: async (pContext) =>
		{
			let tmpResult = libDepAligner.align(pContext.Loader, { Write: true });
			if (tmpResult.Changes.length === 0) { pContext.Log(`deps-align: all ranges already aligned (source: ${tmpResult.VersionSource})`); return {}; }
			tmpResult.Changes.forEach((pChange) => pContext.Log(`  ${pChange.Module}: ${pChange.Dependency}  ${pChange.From} → ${pChange.To}`));
			pContext.Log(`deps-align: ${tmpResult.Changes.length} range(s) aligned`);
			return {};
		}
	}
];

module.exports = TASKS;
