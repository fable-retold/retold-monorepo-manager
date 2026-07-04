const libPictView = require('pict-view');

// origin git URL → browsable https URL (handles git@, git+https, trailing .git)
function _gitUrlToWeb(pUrl)
{
	if (!pUrl) { return ''; }
	let tmpUrl = String(pUrl).trim();
	let tmpSsh = tmpUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
	if (tmpSsh) { return 'https://' + tmpSsh[1] + '/' + tmpSsh[2]; }
	return tmpUrl.replace(/^git\+/, '').replace(/\.git$/, '');
}

// coarse category for a changed-file path → src / test / docs / config (for the rollup summary)
function _fileCategory(pPath)
{
	let tmpPath = String(pPath || '');
	if (/(^|\/)(test|spec)\//i.test(tmpPath) || /\.(test|spec)\./i.test(tmpPath)) { return 'test'; }
	if (/(^|\/)docs?\//i.test(tmpPath) || /\.md$/i.test(tmpPath)) { return 'docs'; }
	if (/package\.json$|\.(json|ya?ml)$|(^|\/)\.[^/]+$/.test(tmpPath)) { return 'config'; }
	return 'src';
}

/**
 * Manager-ModuleWorkspace — per-module detail + actions (center view). Every action routes through
 * the WS provider's enqueueOperation chokepoint so output streams into the bottom panel.
 *
 * Information density + the market-researched action-group taxonomy (labeled npm/version/git/publish
 * groups, primary buttons inline + overflow menus) are ported from the old retold-manager. Fork / PR /
 * upstream data + buttons do not exist — the fork model is retired, so there is one origin repo.
 */
class ManagerModuleWorkspaceView extends libPictView
{
	loadModule(pName)
	{
		this._boundName = pName;
		this.pict.AppData.Manager.SelectedModule = pName;
		this.pict.ContentAssignment.assignContent('#RM-Workspace-Content', '<div class="mm-workspace"><p class="mm-muted">Loading ' + pName + '…</p></div>');
		let tmpSelf = this;
		this.pict.providers.ManagerAPI.loadModuleDetail(pName).then(function ()
			{
				if (tmpSelf._boundName === pName) { tmpSelf.render(); }
			}).catch(function (pError)
			{
				tmpSelf.pict.ContentAssignment.assignContent('#RM-Workspace-Content', '<div class="mm-workspace"><p class="mm-muted">Could not load ' + pName + ': ' + pError.message + '</p></div>');
			});
		// keep the list highlight in sync
		let tmpList = this.pict.views['Manager-ModuleList']; if (tmpList) { tmpList.render(); }
	}

	refreshDetail(pName)
	{
		if (this._boundName !== pName) { return; }
		let tmpSelf = this;
		this.pict.providers.ManagerAPI.loadModuleDetail(pName).then(function () { if (tmpSelf._boundName === pName) { tmpSelf.render(); } }).catch(function () {});
	}

	// npm publish semantics: origin-only next-action taxonomy (server only ever returns these)
	_actionMeta(pCode)
	{
		switch (pCode)
		{
			case 'commit': return { Label: 'commit', BadgeClass: 'mm-next-commit', Tooltip: 'Uncommitted changes — commit them' };
			case 'pull':   return { Label: 'pull',   BadgeClass: 'mm-next-pull',   Tooltip: 'origin has commits your checkout lacks — pull them' };
			case 'push':   return { Label: 'push',   BadgeClass: 'mm-next-push',   Tooltip: 'Local commits not on origin — push them' };
			default:       return { Label: 'in sync', BadgeClass: 'mm-next-none',  Tooltip: 'Local and origin match' };
		}
	}

	_buildDepSlot(pLabel, pDeps)
	{
		let tmpList = pDeps || [];
		if (!tmpList.length) { return []; }
		let tmpRows = tmpList.map((pDep) => ({ Name: pDep.Name, Range: pDep.Range || '', NameEnc: encodeURIComponent(pDep.Name || '') }));
		return [ { Label: pLabel, Count: tmpRows.length, Deps: tmpRows } ];
	}

	onBeforeRender(pRenderable)
	{
		let tmpRecord = this.pict.AppData.Manager.ModuleWorkspaceRecord;
		let tmpDetail = this.pict.AppData.Manager.SelectedModuleDetail;
		if (!tmpDetail)
		{
			Object.assign(tmpRecord, { Empty: true, Name: '', Group: '', Path: '', Version: '', TypeBadge: '', Branch: '', AheadBehind: '', State: '', NextAction: '',
				DescriptionSlot: [], LinksSlot: [], DirtySlot: [], NextChipSlot: [], InfoBoxSlot: [], FilesSlot: [],
				RetoldDepsSlot: [], ExternalDepsSlot: [], RetoldDevDepsSlot: [], ExternalDevDepsSlot: [], RelatedSlot: [] });
			return super.onBeforeRender(pRenderable);
		}

		let tmpManifest = tmpDetail.Manifest || {};
		let tmpPackage = tmpDetail.Package || {};
		let tmpGit = tmpDetail.GitStatus || {};

		// changed files + category rollup
		let tmpCounts = { src: 0, test: 0, docs: 0, config: 0 };
		let tmpFiles = (tmpGit.Files || []).map((pFile) =>
			{
				let tmpStatus = pFile.Status || '';
				let tmpX = tmpStatus.charAt(0);
				let tmpY = tmpStatus.charAt(1);
				let tmpUntracked = (tmpStatus === '??');
				let tmpStaged = !tmpUntracked && tmpX !== ' ' && tmpX !== '';
				let tmpUnstaged = tmpUntracked || (tmpY !== ' ' && tmpY !== '');
				let tmpLabel = tmpUntracked ? 'untracked'
					: [ tmpStaged ? 'staged' : null, tmpUnstaged ? 'unstaged' : null ].filter(Boolean).join(' + ');
				let tmpClass = tmpUntracked ? 'mm-file-untracked' : tmpStaged && !tmpUnstaged ? 'mm-file-staged' : 'mm-file-unstaged';
				tmpCounts[_fileCategory(pFile.Path)]++;
				return {
					Status: tmpStatus.trim() || '··',
					Path: pFile.Path,
					PathJs: String(pFile.Path).replace(/'/g, "\\'"),
					Label: tmpLabel,
					LabelClass: tmpClass,
					StageSlot: tmpUnstaged ? [ { Path: pFile.Path, PathJs: String(pFile.Path).replace(/'/g, "\\'") } ] : []
				};
			});
		let tmpSummary = [ 'src', 'test', 'docs', 'config' ].filter((k) => tmpCounts[k]).map((k) => tmpCounts[k] + ' ' + k).join(' · ');

		// dependency sections
		let tmpDeps = (tmpDetail.CategorizedDeps && tmpDetail.CategorizedDeps.Dependencies) || { Ecosystem: [], External: [] };
		let tmpDevDeps = (tmpDetail.CategorizedDeps && tmpDetail.CategorizedDeps.DevDependencies) || { Ecosystem: [], External: [] };

		// links: single repo (origin == canonical now), npm, docs
		let tmpLinks = [];
		let tmpRepoUrl = (typeof tmpManifest.GitHub === 'string' && tmpManifest.GitHub) || _gitUrlToWeb(tmpGit.OriginUrl);
		if (tmpRepoUrl) { tmpLinks.push({ Label: 'GitHub', Url: tmpRepoUrl, Title: 'Repository on GitHub' }); }
		if (tmpPackage.Name) { tmpLinks.push({ Label: 'npm', Url: 'https://www.npmjs.com/package/' + encodeURIComponent(tmpPackage.Name), Title: 'Package on npm' }); }
		if (tmpManifest.Documentation) { tmpLinks.push({ Label: 'Docs', Url: tmpManifest.Documentation, Title: 'Documentation' }); }

		// next-action chip + dirty dot
		let tmpChip = this._actionMeta(tmpGit.NextAction);
		let tmpDirtyState = tmpGit.HasUnstaged ? 'unstaged' : (tmpGit.HasStaged ? 'staged' : ((tmpGit.Ahead || 0) > 0 ? 'unpushed' : null));
		let tmpDirtyParts = [];
		if (tmpGit.HasUnstaged) { tmpDirtyParts.push('Unstaged changes'); }
		if (tmpGit.HasStaged) { tmpDirtyParts.push('Staged (uncommitted)'); }
		if ((tmpGit.Ahead || 0) > 0) { tmpDirtyParts.push(tmpGit.Ahead + ' unpushed commit' + (tmpGit.Ahead === 1 ? '' : 's')); }

		let tmpInfoBox =
			{
				PkgName: tmpPackage.Name || '—',
				PkgVersion: tmpPackage.Version || '—',
				DepsCount: tmpPackage.Dependencies ? Object.keys(tmpPackage.Dependencies).length : 0,
				DevDepsCount: tmpPackage.DevDependencies ? Object.keys(tmpPackage.DevDependencies).length : 0,
				GitBranch: tmpGit.Branch || '—',
				LocalOriginLabel: '↑ ' + (tmpGit.Ahead || 0) + ' / ↓ ' + (tmpGit.Behind || 0),
				LocalOriginTip: '↑ committed but not pushed to origin · ↓ commits on origin your checkout lacks',
				NextChipSlot: [ tmpChip ]
			};

		Object.assign(tmpRecord,
			{
				Empty: false,
				Name: tmpManifest.Name,
				Group: tmpManifest.Group,
				Path: tmpManifest.Path || '',
				Version: tmpPackage.Version || '—',
				TypeBadge: tmpManifest.Type || 'library',
				Branch: tmpGit.Branch || '—',
				AheadBehind: ((tmpGit.Ahead ? '↑' + tmpGit.Ahead : '') + (tmpGit.Behind ? '↓' + tmpGit.Behind : '')) || '·',
				State: tmpGit.Dirty ? 'dirty' : 'clean',
				NextAction: tmpGit.NextAction || '—',
				DescriptionSlot: tmpManifest.Description ? [ { Description: tmpManifest.Description } ] : [],
				LinksSlot: tmpLinks,
				DirtySlot: tmpDirtyState ? [ { State: tmpDirtyState, Tooltip: tmpDirtyParts.join(' · ') } ] : [],
				NextChipSlot: [ tmpChip ],
				InfoBoxSlot: [ tmpInfoBox ],
				FilesSlot: tmpFiles.length ? [ { Files: tmpFiles, Count: tmpFiles.length, Summary: tmpSummary, StageAllSlot: tmpGit.HasUnstaged ? [ {} ] : [] } ] : [],
				RetoldDepsSlot: this._buildDepSlot('Ecosystem dependencies', tmpDeps.Ecosystem),
				ExternalDepsSlot: this._buildDepSlot('External dependencies', tmpDeps.External),
				RetoldDevDepsSlot: this._buildDepSlot('Ecosystem dev dependencies', tmpDevDeps.Ecosystem),
				ExternalDevDepsSlot: this._buildDepSlot('External dev dependencies', tmpDevDeps.External),
				RelatedSlot: (tmpManifest.RelatedModules && tmpManifest.RelatedModules.length)
					? [ { Related: tmpManifest.RelatedModules.map((n) => ({ Name: n, NameEnc: encodeURIComponent(n) })) } ] : []
			});
		return super.onBeforeRender(pRenderable);
	}

	onAfterRender(pRenderable)
	{
		this.pict.CSSMap.injectCSS();
		// preserve the info-box collapse state across re-renders (default collapsed)
		let tmpBox = document.getElementById('RM-Mod-InfoBox');
		if (tmpBox && this._infoBoxCollapsed !== false) { tmpBox.classList.add('mm-collapsed'); }
		return super.onAfterRender(pRenderable);
	}

	toggleInfoBox()
	{
		// default state is collapsed (undefined or true) → first click expands
		let tmpCollapsed = (this._infoBoxCollapsed !== false);
		this._infoBoxCollapsed = !tmpCollapsed;
		let tmpEl = document.getElementById('RM-Mod-InfoBox');
		if (tmpEl) { tmpEl.classList.toggle('mm-collapsed', this._infoBoxCollapsed); }
	}

	// ─── actions ─────────────────────────────────────────────────
	_enqueueRun(pLabel, pFn)
	{
		let tmpName = this._boundName;
		let tmpWS = this.pict.providers.ManagerOperationsWS;
		tmpWS.enqueueOperation(function () { tmpWS.beginOperation(pLabel, tmpName); pFn(); }, { Label: pLabel, ModuleName: tmpName });
	}

	runAction(pOp)
	{
		let tmpName = this._boundName;
		let tmpAPI = this.pict.providers.ManagerAPI;
		switch (pOp)
		{
			case 'install': return this._enqueueRun('install ' + tmpName, () => tmpAPI.runModuleOperation(tmpName, 'npm', [ 'install' ], 'install'));
			case 'test': return this._enqueueRun('test ' + tmpName, () => tmpAPI.runModuleOperation(tmpName, 'npm', [ 'test' ], 'test'));
			case 'build': return this._enqueueRun('build ' + tmpName, () => tmpAPI.runModuleOperation(tmpName, 'npm', [ 'run', 'build' ], 'build'));
			case 'types': return this._enqueueRun('types ' + tmpName, () => tmpAPI.runModuleOperation(tmpName, 'npm', [ 'run', 'types' ], 'types'));
			case 'ncu': return this._enqueueRun('ncu ' + tmpName, () => tmpAPI.runNcu(tmpName, false, 'all'));
			case 'add': return this._enqueueRun('git add ' + tmpName, () => tmpAPI.gitAddAll(tmpName));
			case 'pull': return this._enqueueRun('pull ' + tmpName, () => tmpAPI.runModuleOperation(tmpName, 'git', [ 'pull', '--rebase' ], 'pull'));
			case 'push': return this._enqueueRun('push ' + tmpName, () => tmpAPI.runModuleOperation(tmpName, 'git', [ 'push' ], 'push'));
			case 'bump-patch': return this._enqueueRun('version patch ' + tmpName, () => tmpAPI.bumpVersion(tmpName, 'patch'));
			case 'bump-minor': return this._enqueueRun('version minor ' + tmpName, () => tmpAPI.bumpVersion(tmpName, 'minor'));
			case 'bump-major': return this._enqueueRun('version major ' + tmpName, () => tmpAPI.bumpVersion(tmpName, 'major'));
			case 'commit': return this._commit();
			case 'diff': return this._diff();
			case 'publish-check': return this._publishCheck();
			case 'bulk-ops': return this._bulkOps();
			default: return;
		}
	}

	_openOverflow(pGroup, pAnchor)
	{
		let tmpModal = this.pict.views['Pict-Section-Modal'];
		if (!tmpModal || typeof tmpModal.dropdown !== 'function') { return; }
		let tmpItems;
		switch (pGroup)
		{
			case 'npm': tmpItems = [ { Hash: 'build', Label: 'build' }, { Hash: 'ncu', Label: 'ncu' }, { Hash: 'types', Label: 'run types' } ]; break;
			case 'version': tmpItems = [ { Hash: 'bump-minor', Label: '+ minor' }, { Hash: 'bump-major', Label: '+ major' } ]; break;
			default: return;
		}
		let tmpSelf = this;
		tmpModal.dropdown(pAnchor, { align: 'right', items: tmpItems }).then(function (pChoice)
			{
				if (pChoice && pChoice.Hash) { tmpSelf.runAction(pChoice.Hash); }
			});
	}

	_bulkOps()
	{
		// pre-scope the bulk wizard to this module (harmless hint if the wizard doesn't read it yet), then route
		this.pict.AppData.Manager.BulkPreCheck = [ this._boundName ];
		window.location.hash = '#/Bulk';
	}

	stageFile(pPath)
	{
		let tmpName = this._boundName;
		let tmpSelf = this;
		this._enqueueRun('git add ' + pPath, () => tmpSelf.pict.providers.ManagerAPI.gitAddPaths(tmpName, [ pPath ]));
	}

	_modal() { return this.pict.views['Pict-Section-Modal']; }

	_commit()
	{
		let tmpName = this._boundName;
		let tmpSelf = this;
		this._modal().show(
			{
				title: 'Commit — ' + tmpName,
				content: '<p>Commit message:</p><input type="text" id="mm-commit-msg" style="width:100%;font:inherit;padding:6px 8px" autofocus>',
				buttons: [ { Hash: 'cancel', Label: 'Cancel' }, { Hash: 'ok', Label: 'Commit', Style: 'primary' } ]
			}).then(function (pChoice)
			{
				if (pChoice !== 'ok') { return; }
				let tmpInput = document.getElementById('mm-commit-msg');
				let tmpMessage = tmpInput ? (tmpInput.value || '').trim() : '';
				if (!tmpMessage) { return; }
				tmpSelf._enqueueRun('commit ' + tmpName, () => tmpSelf.pict.providers.ManagerAPI.commitModule(tmpName, tmpMessage));
			});
	}

	_diff()
	{
		let tmpName = this._boundName;
		let tmpSelf = this;
		this.pict.providers.ManagerAPI.fetchGitDiffText(tmpName).then(function (pText)
			{
				let tmpRaw = String(pText || '');
				if (!tmpRaw.trim())
				{
					tmpSelf._modal().show({ title: 'Diff — ' + tmpName, content: '<p class="mm-muted">(no uncommitted changes)</p>', buttons: [ { Hash: 'ok', Label: 'Close' } ] });
					return;
				}
				let tmpHtml = tmpRaw.split('\n').map(function (pLine)
					{
						let tmpEsc = pLine.replace(/[&<>]/g, (pChar) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[pChar])) || ' ';
						let tmpStyle = '';
						if (pLine.charAt(0) === '+' && pLine.slice(0, 3) !== '+++') { tmpStyle = 'color:var(--color-success)'; }
						else if (pLine.charAt(0) === '-' && pLine.slice(0, 3) !== '---') { tmpStyle = 'color:var(--color-danger)'; }
						else if (pLine.charAt(0) === '@') { tmpStyle = 'color:var(--color-accent)'; }
						else if (pLine.slice(0, 4) === 'diff' || pLine.slice(0, 3) === '+++' || pLine.slice(0, 3) === '---' || pLine.slice(0, 5) === 'index') { tmpStyle = 'color:var(--color-muted)'; }
						return '<span style="' + tmpStyle + '">' + tmpEsc + '</span>';
					}).join('\n');
				tmpSelf._modal().show({ title: 'Diff — ' + tmpName, content: '<pre style="max-height:60vh;overflow:auto;font-size:12px;white-space:pre-wrap;font-family:var(--font-mono)">' + tmpHtml + '</pre>', buttons: [ { Hash: 'ok', Label: 'Close' } ] });
			});
	}

	_publishCheck()
	{
		let tmpName = this._boundName;
		let tmpSelf = this;
		this.pict.providers.ManagerAPI.loadPublishPreview(tmpName).then(function (pReport)
			{
				let tmpProblems = (pReport.Problems || []).map((pProblem) => '• [' + (pProblem.Severity || '?') + '] ' + pProblem.Code + ': ' + pProblem.Message).join('<br>') || 'none';
				let tmpOk = !!pReport.OkToPublish;
				let tmpGate = tmpOk
					? '<span style="color:var(--color-success)">✓ ready to publish</span>'
					: '<span style="color:var(--color-warning)">not publishable — resolve the problems above</span>';
				let tmpButtons = [ { Hash: 'cancel', Label: 'Close' } ];
				if (tmpOk && pReport.PreviewHash)
				{
					tmpButtons.push({ Hash: 'publish', Label: 'Publish v' + (pReport.LocalVersion || '?'), Style: 'danger' });
				}
				tmpSelf._modal().show(
					{
						title: 'Publish check — ' + tmpName,
						content: '<div style="font-size:13px;line-height:1.6">Local: <b>' + (pReport.LocalVersion || '?') + '</b><br>Published: ' + (pReport.PublishedVersion || '(unpublished)') + '<br>' + tmpGate + '<br><br>Problems:<br>' + tmpProblems + '</div>',
						buttons: tmpButtons
					}).then(function (pChoice)
					{
						if (pChoice !== 'publish') { return; }
						tmpSelf._enqueueRun('publish ' + tmpName, () => tmpSelf.pict.providers.ManagerAPI.publishModule(tmpName, pReport.PreviewHash));
					});
			}).catch(function (pError)
			{
				tmpSelf._modal().show({ title: 'Publish check failed', content: '<p>' + pError.message + '</p>', buttons: [ { Hash: 'ok', Label: 'Close' } ] });
			});
	}
}

ManagerModuleWorkspaceView.default_configuration =
	{
		ViewIdentifier: 'Manager-ModuleWorkspace',
		DefaultRenderable: 'Manager-ModuleWorkspace-Content',
		DefaultDestinationAddress: '#RM-Workspace-Content',
		DefaultTemplateRecordAddress: 'AppData.Manager.ModuleWorkspaceRecord',
		AutoRender: false,
		Templates:
		[
			{
				Hash: 'Manager-ModuleWorkspace-Content',
				Template: /*html*/`
<div class="mm-workspace">
	{~TS:Manager-ModuleWorkspace-InfoBox:Record.InfoBoxSlot~}

	<div class="mm-ws-header">
		<span class="mm-ws-name">{~D:Record.Name~}</span>
		<span class="mm-ws-version">v{~D:Record.Version~}</span>
		<span class="mm-ws-branch">{~D:Record.Branch~}</span>
		<span class="mm-type-badge">{~D:Record.TypeBadge~}</span>
		{~TS:Manager-ModuleWorkspace-Dirty:Record.DirtySlot~}
		{~TS:Manager-ModuleWorkspace-NextChip:Record.NextChipSlot~}
		<span class="mm-ws-header-right">{~TS:Manager-ModuleWorkspace-Link:Record.LinksSlot~}</span>
	</div>
	<div class="mm-sub">{~D:Record.Group~} · {~D:Record.Path~}</div>
	{~TS:Manager-ModuleWorkspace-Desc:Record.DescriptionSlot~}

	<div class="mm-action-groups">
		<div class="mm-action-group">
			<div class="mm-action-group-label">npm</div>
			<div class="mm-action-row">
				<button class="mm-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('install')">install</button>
				<button class="mm-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('test')">test</button>
				<button class="mm-btn mm-action-more" title="More npm actions" aria-label="More npm actions" onclick="_Pict.views['Manager-ModuleWorkspace']._openOverflow('npm', this); event.stopPropagation();">▾</button>
			</div>
		</div>
		<div class="mm-action-group">
			<div class="mm-action-group-label">version</div>
			<div class="mm-action-row">
				<button class="mm-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('bump-patch')">+ patch</button>
				<button class="mm-btn mm-action-more" title="More version actions" aria-label="More version actions" onclick="_Pict.views['Manager-ModuleWorkspace']._openOverflow('version', this); event.stopPropagation();">▾</button>
			</div>
		</div>
		<div class="mm-action-group">
			<div class="mm-action-group-label">git</div>
			<div class="mm-action-row">
				<button class="mm-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('add')">add -A</button>
				<button class="mm-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('diff')">diff</button>
				<button class="mm-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('commit')">commit</button>
				<button class="mm-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('push')">push</button>
				<button class="mm-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('pull')">pull</button>
			</div>
		</div>
		<div class="mm-action-group">
			<div class="mm-action-group-label">publish</div>
			<div class="mm-action-row">
				<button class="mm-btn mm-btn-primary" title="Preview publishability, then publish" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('publish-check')">publish check</button>
				<button class="mm-btn" title="Open the bulk-ops wizard pre-scoped to this module" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('bulk-ops')">bulk ops</button>
			</div>
		</div>
	</div>

	{~TS:Manager-ModuleWorkspace-Files:Record.FilesSlot~}
	{~TS:Manager-ModuleWorkspace-DepSectionLink:Record.RetoldDepsSlot~}
	{~TS:Manager-ModuleWorkspace-DepSectionPlain:Record.ExternalDepsSlot~}
	{~TS:Manager-ModuleWorkspace-DepSectionLink:Record.RetoldDevDepsSlot~}
	{~TS:Manager-ModuleWorkspace-DepSectionPlain:Record.ExternalDevDepsSlot~}
	{~TS:Manager-ModuleWorkspace-Related:Record.RelatedSlot~}
</div>`
			},
			{
				Hash: 'Manager-ModuleWorkspace-InfoBox',
				Template: /*html*/`<div id="RM-Mod-InfoBox" class="mm-infobox mm-collapsed" onclick="_Pict.views['Manager-ModuleWorkspace'].toggleInfoBox()">
	<div class="mm-ib-header">
		<span class="mm-ib-name">{~D:Record.PkgName~}</span>
		<span class="mm-ib-version">v{~D:Record.PkgVersion~}</span>
		{~TS:Manager-ModuleWorkspace-NextChip:Record.NextChipSlot~}
		<span class="mm-ib-toggle"></span>
	</div>
	<div class="mm-ib-body" onclick="event.stopPropagation()">
		<div class="mm-ib-section">
			<h4>Package</h4>
			<dl class="mm-kv">
				<dt>name</dt><dd>{~D:Record.PkgName~}</dd>
				<dt>version</dt><dd>{~D:Record.PkgVersion~}</dd>
				<dt>dependencies</dt><dd>{~D:Record.DepsCount~}</dd>
				<dt>devDependencies</dt><dd>{~D:Record.DevDepsCount~}</dd>
			</dl>
		</div>
		<div class="mm-ib-section">
			<h4>Git status</h4>
			<dl class="mm-kv">
				<dt>branch</dt><dd>{~D:Record.GitBranch~}</dd>
				<dt>local → origin</dt><dd title="{~D:Record.LocalOriginTip~}">{~D:Record.LocalOriginLabel~}</dd>
				<dt>next</dt><dd>{~TS:Manager-ModuleWorkspace-NextChip:Record.NextChipSlot~}</dd>
			</dl>
		</div>
	</div>
</div>`
			},
			{ Hash: 'Manager-ModuleWorkspace-Dirty', Template: /*html*/`<span class="mm-dirty mm-dirty-{~D:Record.State~}" title="{~D:Record.Tooltip~}">●</span>` },
			{ Hash: 'Manager-ModuleWorkspace-NextChip', Template: /*html*/`<span class="mm-next {~D:Record.BadgeClass~}" title="{~D:Record.Tooltip~}">{~D:Record.Label~}</span>` },
			{ Hash: 'Manager-ModuleWorkspace-Link', Template: /*html*/`<a class="mm-ws-link" href="{~D:Record.Url~}" target="_blank" rel="noopener" title="{~D:Record.Title~}">{~D:Record.Label~}</a>` },
			{ Hash: 'Manager-ModuleWorkspace-Desc', Template: /*html*/`<p class="mm-ws-desc">{~D:Record.Description~}</p>` },
			{ Hash: 'Manager-ModuleWorkspace-Files', Template: /*html*/`<div class="mm-ws-section"><h3>Changed files ({~D:Record.Count~}) <span class="mm-file-rollup">{~D:Record.Summary~}</span> {~TS:Manager-ModuleWorkspace-StageAll:Record.StageAllSlot~}</h3>{~TS:Manager-ModuleWorkspace-FileRow:Record.Files~}</div>` },
			{ Hash: 'Manager-ModuleWorkspace-StageAll', Template: /*html*/`<button class="mm-file-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('add')">stage all</button>` },
			{ Hash: 'Manager-ModuleWorkspace-FileRow', Template: /*html*/`<div class="mm-file-row"><span class="mm-file-badge {~D:Record.LabelClass~}">{~D:Record.Label~}</span> <code class="mm-file-x">{~D:Record.Status~}</code> <span class="mm-file-path">{~D:Record.Path~}</span>{~TS:Manager-ModuleWorkspace-FileStage:Record.StageSlot~}</div>` },
			{ Hash: 'Manager-ModuleWorkspace-FileStage', Template: /*html*/`<button class="mm-file-btn" title="git add {~D:Record.Path~}" onclick="_Pict.views['Manager-ModuleWorkspace'].stageFile('{~D:Record.PathJs~}')">stage</button>` },
			{ Hash: 'Manager-ModuleWorkspace-DepSectionLink', Template: /*html*/`<div class="mm-ws-section mm-dep-section"><h3>{~D:Record.Label~} ({~D:Record.Count~})</h3><table class="mm-dep-table"><tbody>{~TS:Manager-ModuleWorkspace-DepRowLink:Record.Deps~}</tbody></table></div>` },
			{ Hash: 'Manager-ModuleWorkspace-DepSectionPlain', Template: /*html*/`<div class="mm-ws-section mm-dep-section"><h3>{~D:Record.Label~} ({~D:Record.Count~})</h3><table class="mm-dep-table"><tbody>{~TS:Manager-ModuleWorkspace-DepRowPlain:Record.Deps~}</tbody></table></div>` },
			{ Hash: 'Manager-ModuleWorkspace-DepRowLink', Template: /*html*/`<tr><td class="mm-dep-name"><a href="#/Module/{~D:Record.NameEnc~}">{~D:Record.Name~}</a></td><td class="mm-dep-range">{~D:Record.Range~}</td></tr>` },
			{ Hash: 'Manager-ModuleWorkspace-DepRowPlain', Template: /*html*/`<tr><td class="mm-dep-name mm-dep-external">{~D:Record.Name~}</td><td class="mm-dep-range">{~D:Record.Range~}</td></tr>` },
			{ Hash: 'Manager-ModuleWorkspace-Related', Template: /*html*/`<div class="mm-ws-section"><h3>Related modules</h3><div class="mm-related-row">{~TS:Manager-ModuleWorkspace-RelatedItem:Record.Related~}</div></div>` },
			{ Hash: 'Manager-ModuleWorkspace-RelatedItem', Template: /*html*/`<a class="mm-ws-link" href="#/Module/{~D:Record.NameEnc~}">{~D:Record.Name~}</a>` }
		],
		Renderables:
		[
			{ RenderableHash: 'Manager-ModuleWorkspace-Content', TemplateHash: 'Manager-ModuleWorkspace-Content', ContentDestinationAddress: '#RM-Workspace-Content', RenderMethod: 'replace' }
		]
	};

module.exports = ManagerModuleWorkspaceView;
