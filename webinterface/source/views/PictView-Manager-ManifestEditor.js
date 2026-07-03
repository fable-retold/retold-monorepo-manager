const libPictView = require('pict-view');

function esc(pText)
{
	return String(pText === undefined || pText === null ? '' : pText).replace(/[&<>"]/g, (pChar) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[pChar]));
}

/**
 * Manager-ManifestEditor — a center view (#/Manifest) for editing the Modules-Manifest.json:
 * browse modules grouped by family, add / edit / remove entries. Backed by the server's
 * atomic-write + reload manifest-edit routes via ManagerAPI (create/update/deleteManifestModule).
 */
class ManagerManifestEditorView extends libPictView
{
	reload()
	{
		let tmpSelf = this;
		let tmpAPI = this.pict.providers.ManagerAPI;
		tmpAPI.loadManifest().then(
			(pManifest) => { tmpSelf.pict.AppData.Manager.Manifest = pManifest || {}; tmpSelf.render(); },
			(pError) => { tmpSelf.pict.ContentAssignment.assignContent('#RM-Workspace-Content', '<div class="mm-workspace"><p class="mm-muted">Could not load manifest: ' + esc(pError && pError.message) + '</p></div>'); });
	}

	onBeforeRender(pRenderable)
	{
		let tmpManifest = this.pict.AppData.Manager.Manifest || {};
		let tmpGroups = Array.isArray(tmpManifest.Groups) ? tmpManifest.Groups : [];
		let tmpCount = 0;
		let tmpGroupRecords = tmpGroups.map((pGroup) =>
			{
				let tmpModules = Array.isArray(pGroup.Modules) ? pGroup.Modules : [];
				tmpCount += tmpModules.length;
				return {
					Name: pGroup.Name || pGroup.Group || 'Ungrouped',
					Count: tmpModules.length,
					Rows: tmpModules.map((pModule) => ({
						Name: pModule.Name,
						NameJs: String(pModule.Name).replace(/'/g, "\\'"),
						Path: pModule.Path || '',
						Type: pModule.Type || 'library'
					}))
				};
			});
		Object.assign(this.pict.AppData.Manager.ManifestRecord,
			{
				ManifestName: tmpManifest.Name || 'Modules-Manifest.json',
				ModuleCount: tmpCount,
				GroupCount: tmpGroupRecords.length,
				Groups: tmpGroupRecords,
				EmptySlot: tmpGroupRecords.length === 0 ? [ {} ] : []
			});
		return super.onBeforeRender(pRenderable);
	}

	onAfterRender(pRenderable)
	{
		this.pict.CSSMap.injectCSS();
		return super.onAfterRender(pRenderable);
	}

	_modal() { return this.pict.views['Pict-Section-Modal']; }

	_groupNames()
	{
		let tmpGroups = (this.pict.AppData.Manager.Manifest && this.pict.AppData.Manager.Manifest.Groups) || [];
		return tmpGroups.map((pG) => pG.Name || pG.Group).filter(Boolean);
	}

	_findModule(pName)
	{
		let tmpGroups = (this.pict.AppData.Manager.Manifest && this.pict.AppData.Manager.Manifest.Groups) || [];
		for (let i = 0; i < tmpGroups.length; i++)
		{
			let tmpModules = tmpGroups[i].Modules || [];
			for (let j = 0; j < tmpModules.length; j++)
			{
				if (tmpModules[j].Name === pName) { return Object.assign({ Group: tmpGroups[i].Name || tmpGroups[i].Group }, tmpModules[j]); }
			}
		}
		return null;
	}

	// Build the add/edit form. pModule is null for add, the entry for edit (Name locked on edit).
	_formHtml(pModule)
	{
		let tmpIsEdit = !!pModule;
		let tmpM = pModule || {};
		let tmpGroupOptions = this._groupNames().map((pN) =>
			'<option value="' + esc(pN) + '"' + (tmpM.Group === pN ? ' selected' : '') + '>' + esc(pN) + '</option>').join('');
		let tmpTypes = [ 'library', 'application', 'example', 'tool', 'service' ];
		let tmpTypeOptions = tmpTypes.map((pT) =>
			'<option value="' + pT + '"' + ((tmpM.Type || 'library') === pT ? ' selected' : '') + '>' + pT + '</option>').join('');
		let tmpRow = (pLabel, pField) => '<label class="mm-mf-row"><span class="mm-mf-label">' + pLabel + '</span>' + pField + '</label>';
		return '<div class="mm-mf-form">'
			+ tmpRow('Name', '<input id="mm-mf-name" value="' + esc(tmpM.Name || '') + '"' + (tmpIsEdit ? ' disabled' : '') + '>')
			+ tmpRow('Group', '<select id="mm-mf-group">' + tmpGroupOptions + '</select>')
			+ tmpRow('Path', '<input id="mm-mf-path" value="' + esc(tmpM.Path || '') + '" placeholder="modules/family/name">')
			+ tmpRow('Type', '<select id="mm-mf-type">' + tmpTypeOptions + '</select>')
			+ tmpRow('Description', '<input id="mm-mf-desc" value="' + esc(tmpM.Description || '') + '">')
			+ tmpRow('GitHub', '<input id="mm-mf-github" value="' + esc(tmpM.GitHub || '') + '" placeholder="https://github.com/…">')
			+ tmpRow('Docs', '<input id="mm-mf-docs" value="' + esc(tmpM.Documentation || '') + '" placeholder="https://…">')
			+ '</div>';
	}

	_readForm()
	{
		let tmpGet = (pId) => { let tmpEl = document.getElementById(pId); return tmpEl ? (tmpEl.value || '').trim() : ''; };
		let tmpEntry = {};
		let tmpName = tmpGet('mm-mf-name'); if (tmpName) { tmpEntry.Name = tmpName; }
		let tmpGroup = tmpGet('mm-mf-group'); if (tmpGroup) { tmpEntry.Group = tmpGroup; }
		let tmpPath = tmpGet('mm-mf-path'); if (tmpPath) { tmpEntry.Path = tmpPath; }
		let tmpType = tmpGet('mm-mf-type'); if (tmpType) { tmpEntry.Type = tmpType; }
		let tmpDesc = tmpGet('mm-mf-desc'); if (tmpDesc) { tmpEntry.Description = tmpDesc; }
		let tmpGh = tmpGet('mm-mf-github'); if (tmpGh) { tmpEntry.GitHub = tmpGh; }
		let tmpDocs = tmpGet('mm-mf-docs'); if (tmpDocs) { tmpEntry.Documentation = tmpDocs; }
		return tmpEntry;
	}

	addModule()
	{
		let tmpSelf = this;
		this._modal().show(
			{
				title: 'Add module',
				content: this._formHtml(null),
				buttons: [ { Hash: 'cancel', Label: 'Cancel' }, { Hash: 'save', Label: 'Add', Style: 'primary' } ]
			}).then(function (pChoice)
			{
				if (pChoice !== 'save') { return; }
				let tmpEntry = tmpSelf._readForm();
				if (!tmpEntry.Name) { tmpSelf.pict.PictApplication.setStatus('Module name is required.'); return; }
				tmpSelf.pict.providers.ManagerAPI.createManifestModule(tmpEntry).then(
					() => { tmpSelf.pict.PictApplication.setStatus('Added ' + tmpEntry.Name); tmpSelf.reload(); },
					(pError) => tmpSelf._error('Add failed', pError));
			});
	}

	editModule(pName)
	{
		let tmpSelf = this;
		let tmpModule = this._findModule(pName);
		if (!tmpModule) { return; }
		this._modal().show(
			{
				title: 'Edit — ' + pName,
				content: this._formHtml(tmpModule),
				buttons: [ { Hash: 'cancel', Label: 'Cancel' }, { Hash: 'save', Label: 'Save', Style: 'primary' } ]
			}).then(function (pChoice)
			{
				if (pChoice !== 'save') { return; }
				let tmpEntry = tmpSelf._readForm();
				delete tmpEntry.Name; // Name is the key; not editable here.
				tmpSelf.pict.providers.ManagerAPI.updateManifestModule(pName, tmpEntry).then(
					() => { tmpSelf.pict.PictApplication.setStatus('Saved ' + pName); tmpSelf.reload(); },
					(pError) => tmpSelf._error('Save failed', pError));
			});
	}

	deleteModule(pName)
	{
		let tmpSelf = this;
		this._modal().confirm('Remove "' + pName + '" from the manifest? This edits Modules-Manifest.json (it does not delete any files).',
			{ title: 'Remove module', confirmLabel: 'Remove', cancelLabel: 'Cancel', dangerous: true }).then(function (pOk)
			{
				if (!pOk) { return; }
				tmpSelf.pict.providers.ManagerAPI.deleteManifestModule(pName).then(
					() => { tmpSelf.pict.PictApplication.setStatus('Removed ' + pName); tmpSelf.reload(); },
					(pError) => tmpSelf._error('Remove failed', pError));
			});
	}

	_error(pTitle, pError)
	{
		this._modal().show({ title: pTitle, content: '<p>' + esc(pError && pError.message ? pError.message : pError) + '</p>', buttons: [ { Hash: 'ok', Label: 'Close' } ] });
	}
}

ManagerManifestEditorView.default_configuration =
	{
		ViewIdentifier: 'Manager-ManifestEditor',
		DefaultRenderable: 'Manager-ManifestEditor-Content',
		DefaultTemplateRecordAddress: 'AppData.Manager.ManifestRecord',
		AutoRender: false,
		CSS: /*css*/`
			.mm-mf { padding: 22px 26px; overflow: auto; height: 100%; }
			.mm-mf-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 4px; }
			.mm-mf-header h2 { margin: 0; font-family: var(--font-mono); font-weight: 600; font-size: 20px; color: var(--color-text); }
			.mm-mf-sub { color: var(--color-muted); font-family: var(--font-mono); font-size: 12px; margin-bottom: 14px; }
			.mm-mf-group { margin: 0 0 18px; }
			.mm-mf-grouphdr { font-family: var(--font-mono); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-muted); padding: 6px 0 4px; }
			.mm-mf-table { width: 100%; border-collapse: collapse; font-family: var(--font-mono); font-size: 12.5px; }
			.mm-mf-table td { padding: 5px 8px; border-bottom: 1px solid var(--color-border); color: var(--color-text); vertical-align: baseline; }
			.mm-mf-table td.mm-mf-path { color: var(--color-muted); }
			.mm-mf-table td.mm-mf-type { color: var(--color-muted); white-space: nowrap; }
			.mm-mf-table td.mm-mf-acts { text-align: right; white-space: nowrap; }
			.mm-mf-table tr:hover td { background: var(--color-panel-alt); }
			.mm-mf-link { color: var(--color-accent); text-decoration: none; }
			.mm-mf-link:hover { text-decoration: underline; }
			.mm-mf-del { color: var(--color-danger); }
			/* form (in the add/edit modal) */
			.mm-mf-form { display: flex; flex-direction: column; gap: 8px; min-width: 380px; }
			.mm-mf-row { display: flex; align-items: center; gap: 10px; }
			.mm-mf-label { flex: 0 0 90px; color: var(--color-muted); font-size: 12px; font-family: var(--font-mono); }
			.mm-mf-form input, .mm-mf-form select { flex: 1; padding: 5px 8px; font: inherit; font-size: 13px;
				background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border); border-radius: var(--radius-sm); }
			.mm-mf-form input:disabled { opacity: 0.6; }
		`,
		Templates:
		[
			{
				Hash: 'Manager-ManifestEditor-Content',
				Template: /*html*/`
<div class="mm-mf">
	<div class="mm-mf-header">
		<h2>Manifest</h2>
		<span class="mm-mf-sub">{~D:Record.ModuleCount~} modules · {~D:Record.GroupCount~} groups · {~D:Record.ManifestName~}</span>
	</div>
	<div class="mm-actions">
		<button class="mm-btn mm-btn-primary" onclick="_Pict.views['Manager-ManifestEditor'].addModule()">+ Add module</button>
		<button class="mm-btn" onclick="_Pict.views['Manager-ManifestEditor'].reload()">reload</button>
	</div>
	{~TS:Manager-ManifestEditor-Empty:Record.EmptySlot~}
	{~TS:Manager-ManifestEditor-Group:Record.Groups~}
</div>`
			},
			{ Hash: 'Manager-ManifestEditor-Empty', Template: /*html*/`<p class="mm-muted">No modules in the manifest yet — click “Add module”.</p>` },
			{
				Hash: 'Manager-ManifestEditor-Group',
				Template: /*html*/`<div class="mm-mf-group"><div class="mm-mf-grouphdr">{~D:Record.Name~} · {~D:Record.Count~}</div><table class="mm-mf-table"><tbody>{~TS:Manager-ManifestEditor-Row:Record.Rows~}</tbody></table></div>`
			},
			{
				Hash: 'Manager-ManifestEditor-Row',
				Template: /*html*/`<tr>
	<td><a class="mm-mf-link" href="#/Module/{~D:Record.Name~}">{~D:Record.Name~}</a></td>
	<td class="mm-mf-path">{~D:Record.Path~}</td>
	<td class="mm-mf-type">{~D:Record.Type~}</td>
	<td class="mm-mf-acts"><button class="mm-btn" onclick="_Pict.views['Manager-ManifestEditor'].editModule('{~D:Record.NameJs~}')">edit</button> <button class="mm-btn mm-mf-del" onclick="_Pict.views['Manager-ManifestEditor'].deleteModule('{~D:Record.NameJs~}')">remove</button></td>
</tr>`
			}
		],
		Renderables:
		[
			{ RenderableHash: 'Manager-ManifestEditor-Content', TemplateHash: 'Manager-ManifestEditor-Content', ContentDestinationAddress: '#RM-Workspace-Content', RenderMethod: 'replace' }
		]
	};

module.exports = ManagerManifestEditorView;
