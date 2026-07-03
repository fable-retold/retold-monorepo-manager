const libPictView = require('pict-view');

/**
 * Manager-ModuleWorkspace — per-module detail + actions (center view). Every action routes through
 * the WS provider's enqueueOperation chokepoint so output streams into the bottom panel. Fork/PR
 * buttons do not exist.
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

	onBeforeRender(pRenderable)
	{
		let tmpRecord = this.pict.AppData.Manager.ModuleWorkspaceRecord;
		let tmpDetail = this.pict.AppData.Manager.SelectedModuleDetail;
		if (!tmpDetail) { Object.assign(tmpRecord, { Empty: true, Name: '', Group: '', Path: '', Version: '', Branch: '', AheadBehind: '', State: '', NextAction: '', HasGitHub: [], FilesSlot: [], EcoSlot: [] }); return super.onBeforeRender(pRenderable); }

		let tmpGit = tmpDetail.GitStatus || {};
		let tmpFiles = (tmpGit.Files || []).map((pFile) =>
			{
				// git porcelain XY: X=index (staged), Y=worktree (unstaged). '??' = untracked.
				let tmpStatus = pFile.Status || '';
				let tmpX = tmpStatus.charAt(0);
				let tmpY = tmpStatus.charAt(1);
				let tmpUntracked = (tmpStatus === '??');
				let tmpStaged = !tmpUntracked && tmpX !== ' ' && tmpX !== '';
				let tmpUnstaged = tmpUntracked || (tmpY !== ' ' && tmpY !== '');
				let tmpLabel = tmpUntracked ? 'untracked'
					: [ tmpStaged ? 'staged' : null, tmpUnstaged ? 'unstaged' : null ].filter(Boolean).join(' + ');
				let tmpClass = tmpUntracked ? 'mm-file-untracked' : tmpStaged && !tmpUnstaged ? 'mm-file-staged' : 'mm-file-unstaged';
				return {
					Status: tmpStatus.trim() || '··',
					Path: pFile.Path,
					PathJs: String(pFile.Path).replace(/'/g, "\\'"),
					Label: tmpLabel,
					LabelClass: tmpClass,
					StageSlot: tmpUnstaged ? [ { Path: pFile.Path, PathJs: String(pFile.Path).replace(/'/g, "\\'") } ] : []
				};
			});
		let tmpDeps = (tmpDetail.CategorizedDeps && tmpDetail.CategorizedDeps.Dependencies) || { Ecosystem: [], External: [] };
		let tmpGitHub = (typeof tmpDetail.Manifest.GitHub === 'string') ? tmpDetail.Manifest.GitHub : '';

		Object.assign(tmpRecord,
			{
				Empty: false,
				Name: tmpDetail.Manifest.Name,
				Group: tmpDetail.Manifest.Group,
				Path: tmpDetail.Manifest.Path || '',
				Version: (tmpDetail.Package && tmpDetail.Package.Version) || '—',
				Branch: tmpGit.Branch || '—',
				AheadBehind: ((tmpGit.Ahead ? '↑' + tmpGit.Ahead : '') + (tmpGit.Behind ? '↓' + tmpGit.Behind : '')) || '·',
				State: tmpGit.Dirty ? 'dirty' : 'clean',
				NextAction: tmpGit.NextAction || '—',
				HasGitHub: tmpGitHub ? [ { Url: tmpGitHub } ] : [],
				FilesSlot: tmpFiles.length ? [ { Files: tmpFiles, StageAllSlot: tmpGit.HasUnstaged ? [ {} ] : [] } ] : [],
				EcoSlot: tmpDeps.Ecosystem.length ? [ { Deps: tmpDeps.Ecosystem } ] : []
			});
		return super.onBeforeRender(pRenderable);
	}

	onAfterRender(pRenderable)
	{
		this.pict.CSSMap.injectCSS();
		return super.onAfterRender(pRenderable);
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
		let tmpSelf = this;
		switch (pOp)
		{
			case 'install': return this._enqueueRun('install ' + tmpName, () => tmpAPI.runModuleOperation(tmpName, 'npm', [ 'install' ], 'install'));
			case 'test': return this._enqueueRun('test ' + tmpName, () => tmpAPI.runModuleOperation(tmpName, 'npm', [ 'test' ], 'test'));
			case 'build': return this._enqueueRun('build ' + tmpName, () => tmpAPI.runModuleOperation(tmpName, 'npm', [ 'run', 'build' ], 'build'));
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
			default: return;
		}
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
				// Colorize: added green, removed red, hunk headers accent, file headers muted.
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
				// The handshake: if the server says OkToPublish, offer a Publish button that posts back the
				// PreviewHash. The server re-checks the hash + OkToPublish before running the real npm publish.
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
						// Stream the publish through the same chokepoint as every other action.
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
	<h2>{~D:Record.Name~}</h2>
	<div class="mm-sub">{~D:Record.Group~} · {~D:Record.Path~} · v{~D:Record.Version~}</div>
	<div class="mm-infogrid">
		<span class="k">Branch</span><span>{~D:Record.Branch~} {~D:Record.AheadBehind~}</span>
		<span class="k">State</span><span>{~D:Record.State~} → {~D:Record.NextAction~}</span>
	</div>
	{~TS:Manager-ModuleWorkspace-GitHub:Record.HasGitHub~}
	<div class="mm-actions">
		<button class="mm-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('install')">install</button>
		<button class="mm-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('test')">test</button>
		<button class="mm-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('build')">build</button>
		<button class="mm-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('ncu')">ncu</button>
	</div>
	<div class="mm-actions">
		<button class="mm-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('add')">git add -A</button>
		<button class="mm-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('commit')">commit</button>
		<button class="mm-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('diff')">diff</button>
		<button class="mm-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('pull')">pull</button>
		<button class="mm-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('push')">push</button>
	</div>
	<div class="mm-actions">
		<button class="mm-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('bump-patch')">+patch</button>
		<button class="mm-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('bump-minor')">+minor</button>
		<button class="mm-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('bump-major')">+major</button>
		<button class="mm-btn mm-btn-primary" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('publish-check')">publish check</button>
	</div>
	{~TS:Manager-ModuleWorkspace-Files:Record.FilesSlot~}
	{~TS:Manager-ModuleWorkspace-Eco:Record.EcoSlot~}
</div>`
			},
			{ Hash: 'Manager-ModuleWorkspace-GitHub', Template: /*html*/`<div class="mm-sub"><a href="{~D:Record.Url~}" target="_blank" rel="noopener">{~D:Record.Url~}</a></div>` },
			{ Hash: 'Manager-ModuleWorkspace-Files', Template: /*html*/`<h3 style="margin:18px 0 6px">Changed files {~TS:Manager-ModuleWorkspace-StageAll:Record.StageAllSlot~}</h3>{~TS:Manager-ModuleWorkspace-FileRow:Record.Files~}` },
			{ Hash: 'Manager-ModuleWorkspace-StageAll', Template: /*html*/`<button class="mm-file-btn" onclick="_Pict.views['Manager-ModuleWorkspace'].runAction('add')">stage all</button>` },
			{ Hash: 'Manager-ModuleWorkspace-FileRow', Template: /*html*/`<div class="mm-file-row"><span class="mm-file-badge {~D:Record.LabelClass~}">{~D:Record.Label~}</span> <code class="mm-file-x">{~D:Record.Status~}</code> <span class="mm-file-path">{~D:Record.Path~}</span>{~TS:Manager-ModuleWorkspace-FileStage:Record.StageSlot~}</div>` },
			{ Hash: 'Manager-ModuleWorkspace-FileStage', Template: /*html*/`<button class="mm-file-btn" title="git add {~D:Record.Path~}" onclick="_Pict.views['Manager-ModuleWorkspace'].stageFile('{~D:Record.PathJs~}')">stage</button>` },
			{ Hash: 'Manager-ModuleWorkspace-Eco', Template: /*html*/`<h3 style="margin:18px 0 6px">Ecosystem dependencies</h3>{~TS:Manager-ModuleWorkspace-DepRow:Record.Deps~}` },
			{ Hash: 'Manager-ModuleWorkspace-DepRow', Template: /*html*/`<div class="mm-cell" style="padding:2px 0">{~D:Record.Name~} <span class="mm-muted">{~D:Record.Range~}</span></div>` }
		],
		Renderables:
		[
			{ RenderableHash: 'Manager-ModuleWorkspace-Content', TemplateHash: 'Manager-ModuleWorkspace-Content', ContentDestinationAddress: '#RM-Workspace-Content', RenderMethod: 'replace' }
		]
	};

module.exports = ManagerModuleWorkspaceView;
