/**
 * Api-Files — path-confined file browser + code search.
 *
 * Security (ported faithfully from retold-manager):
 *   - isSafeRelativePath() bans absolute paths and any `..` / empty segment, so join() can't escape.
 *   - Search runs via execFile (no shell) with ripgrep-preferred / grep-fallback, bounded timeout,
 *     maxBuffer, result cap, and a sanitized type filter.
 */
const libFS = require('fs');
const libPath = require('path');
const libChildProcess = require('child_process');

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_SEARCH_RESULTS = 500;
const SEARCH_TIMEOUT_MS = 8000;
const SEARCH_MAX_BUFFER = 16 * 1024 * 1024;
const SKIP_DIRS = new Set([ 'node_modules', '.data', '.git' ]);
const RG_TYPES = new Set([ 'js', 'ts', 'json', 'md', 'css', 'html', 'sh', 'yaml', 'yml' ]);

let _searchTool = null;

function respondError(pRes, pStatus, pCode, pMessage)
{
	pRes.statusCode = pStatus;
	pRes.send({ Error: pCode, Message: pMessage });
}

// The traversal defense: reject absolute paths and any `..`/empty segment. '' means "the root".
function isSafeRelativePath(pPath)
{
	if (typeof pPath !== 'string') { return false; }
	if (pPath.length === 0) { return true; }
	if (pPath.charAt(0) === '/') { return false; }
	let tmpSegments = pPath.split('/');
	for (let i = 0; i < tmpSegments.length; i++)
	{
		if (tmpSegments[i] === '..' || tmpSegments[i] === '') { return false; }
	}
	return true;
}

function classifyExtension(pExtension)
{
	let tmpExt = (pExtension || '').toLowerCase();
	if ([ 'md', 'markdown' ].indexOf(tmpExt) >= 0) { return 'markdown'; }
	if ([ 'js', 'cjs', 'mjs', 'ts', 'json', 'css', 'html', 'sh', 'yml', 'yaml' ].indexOf(tmpExt) >= 0) { return 'code'; }
	if ([ 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico' ].indexOf(tmpExt) >= 0) { return 'image'; }
	if ([ 'zip', 'gz', 'tgz', 'pdf', 'woff', 'woff2', 'ttf' ].indexOf(tmpExt) >= 0) { return 'binary'; }
	return 'text';
}

function readFileConfined(pAbsolutePath)
{
	let tmpStat = libFS.statSync(pAbsolutePath);
	let tmpExtension = libPath.extname(pAbsolutePath).replace(/^\./, '');
	let tmpCategory = classifyExtension(tmpExtension);
	let tmpBase =
		{
			Extension: tmpExtension,
			Category: tmpCategory,
			Size: tmpStat.size,
			Modified: tmpStat.mtime.toISOString()
		};
	if (tmpCategory === 'image' || tmpCategory === 'binary')
	{
		return Object.assign(tmpBase, { Content: null, Truncated: false });
	}
	let tmpTruncated = tmpStat.size > MAX_FILE_BYTES;
	let tmpBuffer = libFS.readFileSync(pAbsolutePath);
	let tmpContent = tmpBuffer.slice(0, MAX_FILE_BYTES).toString('utf8');
	return Object.assign(tmpBase, { Content: tmpContent, Truncated: tmpTruncated });
}

function resolveSearchTool()
{
	if (_searchTool) { return _searchTool; }
	function which(pName)
	{
		try { return libChildProcess.execSync(`command -v ${pName}`, { encoding: 'utf8' }).trim(); }
		catch (pError) { return ''; }
	}
	let tmpRg = which('rg');
	if (tmpRg) { _searchTool = { Name: 'rg', Path: tmpRg }; return _searchTool; }
	let tmpGrep = which('grep');
	if (tmpGrep) { _searchTool = { Name: 'grep', Path: tmpGrep }; return _searchTool; }
	return null;
}

module.exports = function registerFilesRoutes(pCore)
{
	let tmpOrator = pCore.Orator;
	let tmpLoader = pCore.Loader;
	let tmpRepoRoot = tmpLoader.getRepoRoot();

	function moduleOr404(pReq, pRes)
	{
		let tmpModule = tmpLoader.getModule(pReq.params.name);
		if (!tmpModule) { respondError(pRes, 404, 'UnknownModule', `Unknown module: ${pReq.params.name}`); return null; }
		return tmpModule;
	}

	// List a directory within a module.
	tmpOrator.serviceServer.doGet('/api/manager/modules/:name/files', function (pReq, pRes, pNext)
		{
			let tmpModule = moduleOr404(pReq, pRes);
			if (!tmpModule) { return pNext(); }

			let tmpRel = (pReq.query && pReq.query.path) || '';
			if (!isSafeRelativePath(tmpRel)) { respondError(pRes, 400, 'BadPath', 'Illegal path.'); return pNext(); }

			let tmpAbsolute = libPath.join(tmpModule.AbsolutePath, tmpRel);
			let tmpStat;
			try { tmpStat = libFS.statSync(tmpAbsolute); }
			catch (pError) { respondError(pRes, 404, 'NotFound', 'Path not found.'); return pNext(); }
			if (!tmpStat.isDirectory()) { respondError(pRes, 404, 'NotADirectory', 'Path is not a directory.'); return pNext(); }

			let tmpEntries = [];
			let tmpNames = libFS.readdirSync(tmpAbsolute);
			for (let i = 0; i < tmpNames.length; i++)
			{
				let tmpName = tmpNames[i];
				if (SKIP_DIRS.has(tmpName)) { continue; }
				let tmpEntryAbsolute = libPath.join(tmpAbsolute, tmpName);
				let tmpEntryStat;
				try { tmpEntryStat = libFS.lstatSync(tmpEntryAbsolute); }
				catch (pError) { continue; }
				let tmpKind = tmpEntryStat.isSymbolicLink() ? 'symlink' : (tmpEntryStat.isDirectory() ? 'dir' : 'file');
				let tmpExtension = libPath.extname(tmpName).replace(/^\./, '');
				tmpEntries.push(
					{
						Name: tmpName,
						Kind: tmpKind,
						Extension: tmpExtension,
						Category: (tmpKind === 'file') ? classifyExtension(tmpExtension) : null,
						Size: tmpEntryStat.size,
						Modified: tmpEntryStat.mtime.toISOString(),
						Path: tmpRel ? `${tmpRel}/${tmpName}` : tmpName
					});
			}
			tmpEntries.sort((pA, pB) =>
				{
					if (pA.Kind === 'dir' && pB.Kind !== 'dir') { return -1; }
					if (pA.Kind !== 'dir' && pB.Kind === 'dir') { return 1; }
					return pA.Name.localeCompare(pB.Name);
				});

			pRes.send({ Module: tmpModule.Name, Path: tmpRel, Entries: tmpEntries });
			return pNext();
		});

	// Read one file within a module.
	tmpOrator.serviceServer.doGet('/api/manager/modules/:name/file', function (pReq, pRes, pNext)
		{
			let tmpModule = moduleOr404(pReq, pRes);
			if (!tmpModule) { return pNext(); }

			let tmpRel = (pReq.query && pReq.query.path) || '';
			if (!isSafeRelativePath(tmpRel) || tmpRel.length === 0) { respondError(pRes, 400, 'BadPath', 'Illegal path.'); return pNext(); }

			let tmpAbsolute = libPath.join(tmpModule.AbsolutePath, tmpRel);
			try
			{
				let tmpResult = readFileConfined(tmpAbsolute);
				pRes.send(Object.assign({ Module: tmpModule.Name, Path: tmpRel }, tmpResult));
			}
			catch (pError) { respondError(pRes, 404, 'ReadFailed', pError.message); }
			return pNext();
		});

	// Read a file relative to the repo root (for search hits outside any module).
	tmpOrator.serviceServer.doGet('/api/manager/repo/file', function (pReq, pRes, pNext)
		{
			let tmpRel = (pReq.query && pReq.query.path) || '';
			if (!isSafeRelativePath(tmpRel) || tmpRel.length === 0) { respondError(pRes, 400, 'BadPath', 'Illegal path.'); return pNext(); }

			let tmpAbsolute = libPath.join(tmpRepoRoot, tmpRel);
			try
			{
				let tmpResult = readFileConfined(tmpAbsolute);
				pRes.send(Object.assign({ Module: null, Path: tmpRel }, tmpResult));
			}
			catch (pError) { respondError(pRes, 404, 'ReadFailed', pError.message); }
			return pNext();
		});

	// Code search (ripgrep-preferred, grep fallback).
	tmpOrator.serviceServer.doGet('/api/manager/search', function (pReq, pRes, pNext)
		{
			let tmpQuery = (pReq.query && pReq.query.q) || '';
			if (!tmpQuery) { respondError(pRes, 400, 'EmptyQuery', 'q is required.'); return pNext(); }
			if (tmpQuery.length < 2) { respondError(pRes, 400, 'QueryTooShort', 'q must be at least 2 characters.'); return pNext(); }

			let tmpScope = (pReq.query && pReq.query.scope) || 'repo';
			if (tmpScope !== 'repo' && tmpScope !== 'module') { respondError(pRes, 400, 'BadScope', 'scope must be repo or module.'); return pNext(); }

			let tmpCwd = tmpRepoRoot;
			let tmpModuleName = null;
			if (tmpScope === 'module')
			{
				let tmpModule = tmpLoader.getModule(pReq.query.module);
				if (!tmpModule) { respondError(pRes, 404, 'UnknownModule', `Unknown module: ${pReq.query.module}`); return pNext(); }
				tmpCwd = tmpModule.AbsolutePath;
				tmpModuleName = tmpModule.Name;
			}

			let tmpTool = resolveSearchTool();
			if (!tmpTool) { respondError(pRes, 500, 'SearchToolMissing', 'Neither ripgrep nor grep is available.'); return pNext(); }

			let tmpTypes = ((pReq.query && pReq.query.types) || '').split(',').map((pType) => pType.trim().toLowerCase())
				.filter((pType) => /^[a-z0-9_+\-]{1,16}$/.test(pType));

			let tmpArgs;
			if (tmpTool.Name === 'rg')
			{
				tmpArgs = [ '--line-number', '--no-heading', '--column', '--color', 'never', '--max-count', '8', '--max-filesize', '2M', '--smart-case',
					'--glob', '!node_modules', '--glob', '!.git', '--glob', '!.data', '--glob', '!dist', '--glob', '!*.min.js' ];
				tmpTypes.forEach((pType) => { if (RG_TYPES.has(pType)) { tmpArgs.push('--type', pType); } else { tmpArgs.push('--glob', `*.${pType}`); } });
				tmpArgs.push('--', tmpQuery, '.');
			}
			else
			{
				tmpArgs = [ '-rn', '--color=never', '--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=.data', '--exclude-dir=dist' ];
				tmpTypes.forEach((pType) => tmpArgs.push(`--include=*.${pType}`));
				tmpArgs.push('-e', tmpQuery, '.');
			}

			let tmpStartedAt = Date.now();
			libChildProcess.execFile(tmpTool.Path, tmpArgs, { cwd: tmpCwd, timeout: SEARCH_TIMEOUT_MS, maxBuffer: SEARCH_MAX_BUFFER },
				function (pError, pStdout)
				{
					if (pError && pError.killed) { respondError(pRes, 504, 'SearchTimeout', 'Search timed out.'); return pNext(); }
					// grep/rg exit 1 = no matches (not an error).
					let tmpLines = (pStdout || '').split('\n').filter(Boolean);
					let tmpResults = [];
					let tmpTruncated = false;
					for (let i = 0; i < tmpLines.length; i++)
					{
						if (tmpResults.length >= MAX_SEARCH_RESULTS) { tmpTruncated = true; break; }
						let tmpLine = tmpLines[i];
						if (tmpTool.Name === 'rg')
						{
							let tmpMatch = tmpLine.match(/^(.*?):(\d+):(\d+):(.*)$/);
							if (tmpMatch) { tmpResults.push({ Path: tmpMatch[1].replace(/^\.\//, ''), Line: parseInt(tmpMatch[2], 10), Column: parseInt(tmpMatch[3], 10), Text: tmpMatch[4] }); }
						}
						else
						{
							let tmpMatch = tmpLine.match(/^(.*?):(\d+):(.*)$/);
							if (tmpMatch) { tmpResults.push({ Path: tmpMatch[1].replace(/^\.\//, ''), Line: parseInt(tmpMatch[2], 10), Column: 0, Text: tmpMatch[3] }); }
						}
					}
					pRes.send(
						{
							Tool: tmpTool.Name,
							Query: tmpQuery,
							Scope: tmpScope,
							Module: tmpModuleName,
							ElapsedMs: Date.now() - tmpStartedAt,
							TotalHits: tmpResults.length,
							Truncated: tmpTruncated,
							Results: tmpResults
						});
					return pNext();
				});
		});
};
