const libPictView = require('pict-view');

function esc(pText)
{
	return String(pText === undefined || pText === null ? '' : pText).replace(/[&<>"]/g, (pChar) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[pChar]));
}

/**
 * Manager-ScanTable — the wide module-status table (center view, route #/Modules). A row per module
 * joining the manifest (links) with the git/npm scan (branch, ahead/behind origin, next action, local
 * vs published version, and per-category change stats). Local + remote(origin) + npm only — no fork /
 * upstream / PR concepts anywhere. Filters + sortable columns.
 */
class ManagerScanTableView extends libPictView
{
	constructor(pFable, pOptions, pServiceHash)
	{
		super(pFable, pOptions, pServiceHash);
		this._filter = { Query: '', NeedsAction: false, Ahead: false, Behind: false, Dirty: false, UnpubBump: false, VersionMismatch: false, IncludeExamples: false };
		this._sort = { Column: 'Module', Direction: 'asc' };
		this._restoreFocus = false;
	}

	rescan()
	{
		let tmpAPI = this.pict.providers.ManagerAPI;
		if (tmpAPI) { tmpAPI.scanAllModules().catch(() => {}); }
	}

	setQuery(pValue) { this._filter.Query = pValue || ''; this._restoreFocus = true; this.render(); }
	toggleFlag(pName, pChecked) { this._filter[pName] = !!pChecked; this.render(); }
	setSort(pColumn)
	{
		if (this._sort.Column === pColumn) { this._sort.Direction = (this._sort.Direction === 'asc') ? 'desc' : 'asc'; }
		else { this._sort.Column = pColumn; this._sort.Direction = 'asc'; }
		this.render();
	}

	// Local vs published (npm) comparison — computed client-side because the scan runs before the npm
	// version is known. Returns unpublished | unpublished-bump | behind-published | in-sync | unknown.
	_versionState(pLocal, pPublished)
	{
		if (!pPublished) { return pLocal ? 'unpublished' : 'unknown'; }
		if (!pLocal) { return 'unknown'; }
		if (pLocal === pPublished) { return 'in-sync'; }
		let tmpNum = (pV) => String(pV).split('-')[0].split('.').map((pN) => parseInt(pN, 10) || 0);
		let tmpA = tmpNum(pLocal); let tmpB = tmpNum(pPublished);
		for (let i = 0; i < Math.max(tmpA.length, tmpB.length); i++)
		{
			let tmpDiff = (tmpA[i] || 0) - (tmpB[i] || 0);
			if (tmpDiff > 0) { return 'unpublished-bump'; }
			if (tmpDiff < 0) { return 'behind-published'; }
		}
		return 'in-sync';
	}

	_row(pName, pManifest, pScan, pVState)
	{
		let tmpChanges = pScan.Changes || {};
		let tmpBucket = (pKey) => (tmpChanges[pKey] && tmpChanges[pKey].Files) || 0;
		let tmpNext = pScan.NextAction || 'in-sync';
		let tmpVState = pVState || 'unknown';
		let tmpPkg = pScan.PackageName || '';
		return {
			Name: pName,
			NameEnc: encodeURIComponent(pName),
			GhSlot: (pManifest && pManifest.GitHub) ? [ { Url: pManifest.GitHub } ] : [],
			DocsSlot: (pManifest && pManifest.Documentation) ? [ { Url: pManifest.Documentation } ] : [],
			NpmSlot: tmpPkg ? [ { Url: 'https://www.npmjs.com/package/' + tmpPkg } ] : [],
			Branch: pScan.Branch || '—',
			AheadDisplay: (pScan.Ahead || 0) > 0 ? '↑' + pScan.Ahead : '·',
			BehindDisplay: (pScan.Behind || 0) > 0 ? '↓' + pScan.Behind : '·',
			NextClass: 'mm-next mm-next--' + tmpNext,
			NextLabel: (tmpNext === 'in-sync') ? '·' : tmpNext,
			LocalVersion: pScan.LocalVersion || '—',
			PublishedVersion: pScan.PublishedVersion || '(none)',
			PublishedClass: 'mm-ver-' + tmpVState,
			Source: tmpBucket('Source') || '·',
			Tests: tmpBucket('Tests') || '·',
			Docs: tmpBucket('Documentation') || '·',
			Tooling: tmpBucket('Tooling') || '·',
			Total: tmpBucket('Total') || '·',
			// raw sort keys
			_Ahead: pScan.Ahead || 0, _Behind: pScan.Behind || 0, _Next: tmpNext,
			_Source: tmpBucket('Source'), _Tests: tmpBucket('Tests'), _Docs: tmpBucket('Documentation'), _Tooling: tmpBucket('Tooling'), _Total: tmpBucket('Total'),
			_Local: pScan.LocalVersion || '', _Published: pScan.PublishedVersion || '', _Branch: pScan.Branch || ''
		};
	}

	onBeforeRender(pRenderable)
	{
		let tmpManager = this.pict.AppData.Manager;
		let tmpModules = tmpManager.Modules || [];
		let tmpByName = {};
		for (let i = 0; i < tmpModules.length; i++) { tmpByName[tmpModules[i].Name] = tmpModules[i]; }
		let tmpScan = (tmpManager.Scan && tmpManager.Scan.Results) || {};
		let tmpQuery = (this._filter.Query || '').toLowerCase().trim();

		let tmpRows = [];
		for (let i = 0; i < tmpModules.length; i++)
		{
			let tmpName = tmpModules[i].Name;
			let tmpEntry = tmpScan[tmpName];
			if (!tmpEntry || tmpEntry.Error) { continue; }
			let tmpIsExample = (tmpModules[i].Type || 'library') === 'example';
			if (!this._filter.IncludeExamples && tmpIsExample) { continue; }
			if (tmpQuery && tmpName.toLowerCase().indexOf(tmpQuery) < 0) { continue; }
			// flag filters
			if (this._filter.NeedsAction && (tmpEntry.NextAction || 'in-sync') === 'in-sync') { continue; }
			if (this._filter.Ahead && !((tmpEntry.Ahead || 0) > 0)) { continue; }
			if (this._filter.Behind && !((tmpEntry.Behind || 0) > 0)) { continue; }
			if (this._filter.Dirty && !tmpEntry.Dirty) { continue; }
			let tmpVState = this._versionState(tmpEntry.LocalVersion, tmpEntry.PublishedVersion);
			if (this._filter.UnpubBump && tmpVState !== 'unpublished-bump') { continue; }
			if (this._filter.VersionMismatch && (tmpVState !== 'unpublished-bump' && tmpVState !== 'behind-published')) { continue; }
			tmpRows.push(this._row(tmpName, tmpByName[tmpName], tmpEntry, tmpVState));
		}

		// sort
		let tmpCol = this._sort.Column;
		let tmpDir = this._sort.Direction === 'desc' ? -1 : 1;
		let tmpKey = (pRow) =>
			{
				switch (tmpCol)
				{
					case 'Branch': return pRow._Branch;
					case 'Ahead': return pRow._Ahead;
					case 'Behind': return pRow._Behind;
					case 'Next': return pRow._Next;
					case 'Local': return pRow._Local;
					case 'Published': return pRow._Published;
					case 'Source': return pRow._Source;
					case 'Tests': return pRow._Tests;
					case 'Docs': return pRow._Docs;
					case 'Tooling': return pRow._Tooling;
					case 'Total': return pRow._Total;
					default: return pRow.Name;
				}
			};
		tmpRows.sort((pA, pB) =>
			{
				let tmpKa = tmpKey(pA); let tmpKb = tmpKey(pB);
				if (typeof tmpKa === 'number' && typeof tmpKb === 'number') { return (tmpKa - tmpKb) * tmpDir; }
				return String(tmpKa).localeCompare(String(tmpKb)) * tmpDir;
			});

		let tmpMark = (pCol) => (this._sort.Column === pCol) ? (this._sort.Direction === 'asc' ? ' ▲' : ' ▼') : '';
		let tmpScanned = Object.keys(tmpScan).length;
		Object.assign(this.pict.AppData.Manager.ScanRecord,
			{
				Query: this._filter.Query || '',
				StatusText: tmpRows.length + ' of ' + tmpScanned + ' scanned' + (tmpManager.Scan && tmpManager.Scan.Running ? ' · scanning…' : ''),
				NeedsActionChecked: this._filter.NeedsAction ? 'checked' : '',
				AheadChecked: this._filter.Ahead ? 'checked' : '',
				BehindChecked: this._filter.Behind ? 'checked' : '',
				DirtyChecked: this._filter.Dirty ? 'checked' : '',
				UnpubBumpChecked: this._filter.UnpubBump ? 'checked' : '',
				VersionMismatchChecked: this._filter.VersionMismatch ? 'checked' : '',
				IncludeExamplesChecked: this._filter.IncludeExamples ? 'checked' : '',
				Mark: { Module: tmpMark('Module'), Branch: tmpMark('Branch'), Ahead: tmpMark('Ahead'), Behind: tmpMark('Behind'), Next: tmpMark('Next'), Local: tmpMark('Local'), Published: tmpMark('Published'), Source: tmpMark('Source'), Tests: tmpMark('Tests'), Docs: tmpMark('Docs'), Tooling: tmpMark('Tooling'), Total: tmpMark('Total') },
				Rows: tmpRows,
				EmptySlot: tmpRows.length === 0 ? [ {} ] : []
			});
		return super.onBeforeRender(pRenderable);
	}

	onAfterRender(pRenderable)
	{
		if (this._restoreFocus)
		{
			this._restoreFocus = false;
			let tmpInput = document.getElementById('mm-scan-filter');
			if (tmpInput) { tmpInput.focus(); try { tmpInput.setSelectionRange(tmpInput.value.length, tmpInput.value.length); } catch (pError) { /* ignore */ } }
		}
		this.pict.CSSMap.injectCSS();
		return super.onAfterRender(pRenderable);
	}
}

ManagerScanTableView.default_configuration =
	{
		ViewIdentifier: 'Manager-ScanTable',
		DefaultRenderable: 'Manager-ScanTable-Content',
		DefaultTemplateRecordAddress: 'AppData.Manager.ScanRecord',
		AutoRender: false,
		CSS: /*css*/`
			.mm-scan { display: flex; flex-direction: column; height: 100%; min-height: 0; }
			.mm-scan-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--color-border); flex: 0 0 auto; }
			.mm-scan-bar input[type=search] { flex: 0 0 200px; padding: 5px 9px; font: inherit; font-size: 13px; background: var(--color-bg); color: var(--color-text); border: 1px solid var(--color-border); border-radius: var(--radius-sm); }
			.mm-scan-bar label { display: inline-flex; align-items: center; gap: 4px; color: var(--color-muted); font-size: 12px; font-family: var(--font-mono); cursor: pointer; }
			.mm-scan-bar .mm-scan-status { margin-left: auto; color: var(--color-muted); font-size: 12px; font-family: var(--font-mono); }
			.mm-scan-scroll { flex: 1 1 auto; overflow: auto; }
			.mm-scan-table { width: 100%; border-collapse: collapse; font-family: var(--font-mono); font-size: 12px; }
			.mm-scan-table thead th { text-align: left; padding: 7px 8px; background: var(--color-panel); color: var(--color-muted); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid var(--color-border); position: sticky; top: 0; z-index: 1; cursor: pointer; white-space: nowrap; }
			.mm-scan-table thead th.num { text-align: right; }
			.mm-scan-table tbody td { padding: 5px 8px; border-bottom: 1px solid var(--color-border); color: var(--color-text); vertical-align: baseline; white-space: nowrap; }
			.mm-scan-table tbody td.num { text-align: right; font-variant-numeric: tabular-nums; }
			.mm-scan-table tbody tr:hover td { background: var(--color-panel-alt); }
			.mm-scan-name { color: var(--color-text); text-decoration: none; font-weight: 600; }
			.mm-scan-name:hover { color: var(--color-accent); text-decoration: underline; }
			.mm-scan-links a { display: inline-block; margin-right: 4px; padding: 0 5px; background: var(--color-panel-alt); border: 1px solid var(--color-border); border-radius: 3px; color: var(--color-muted); text-decoration: none; font-size: 10px; }
			.mm-scan-links a:hover { color: var(--color-accent); border-color: var(--color-accent); }
			.mm-scan-ab { color: var(--color-muted); }
			.mm-next { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 8px; color: var(--theme-color-text-on-brand, #fff); }
			.mm-next--in-sync { background: transparent; color: var(--color-muted); }
			.mm-next--commit { background: var(--color-warning); }
			.mm-next--pull { background: var(--theme-color-status-info, #4cc9d4); }
			.mm-next--push { background: var(--color-accent); }
			.mm-ver-unpublished-bump { color: var(--color-success); font-weight: 600; }
			.mm-ver-behind-published { color: var(--color-warning); font-weight: 600; }
			.mm-ver-unpublished { color: var(--color-muted); font-style: italic; }
			.mm-ver-unknown { color: var(--color-muted); }
			.mm-scan-zero { color: var(--color-border); }
			.mm-scan-empty { padding: 30px; text-align: center; color: var(--color-muted); font-style: italic; }
		`,
		Templates:
		[
			{
				Hash: 'Manager-ScanTable-Content',
				Template: /*html*/`
<div class="mm-scan">
	<div class="mm-scan-bar">
		<input type="search" id="mm-scan-filter" placeholder="filter modules…" value="{~D:Record.Query~}" oninput="_Pict.views['Manager-ScanTable'].setQuery(this.value)">
		<label title="Anything with a pending next action"><input type="checkbox" {~D:Record.NeedsActionChecked~} onchange="_Pict.views['Manager-ScanTable'].toggleFlag('NeedsAction', this.checked)"> needs action</label>
		<label><input type="checkbox" {~D:Record.AheadChecked~} onchange="_Pict.views['Manager-ScanTable'].toggleFlag('Ahead', this.checked)"> ahead</label>
		<label><input type="checkbox" {~D:Record.BehindChecked~} onchange="_Pict.views['Manager-ScanTable'].toggleFlag('Behind', this.checked)"> behind</label>
		<label><input type="checkbox" {~D:Record.DirtyChecked~} onchange="_Pict.views['Manager-ScanTable'].toggleFlag('Dirty', this.checked)"> dirty</label>
		<label title="Local version ahead of the published npm version"><input type="checkbox" {~D:Record.UnpubBumpChecked~} onchange="_Pict.views['Manager-ScanTable'].toggleFlag('UnpubBump', this.checked)"> unpublished bump</label>
		<label><input type="checkbox" {~D:Record.VersionMismatchChecked~} onchange="_Pict.views['Manager-ScanTable'].toggleFlag('VersionMismatch', this.checked)"> version mismatch</label>
		<label><input type="checkbox" {~D:Record.IncludeExamplesChecked~} onchange="_Pict.views['Manager-ScanTable'].toggleFlag('IncludeExamples', this.checked)"> examples</label>
		<button class="mm-btn" onclick="_Pict.views['Manager-ScanTable'].rescan()">rescan</button>
		<span class="mm-scan-status">{~D:Record.StatusText~}</span>
	</div>
	<div class="mm-scan-scroll">
		{~TS:Manager-ScanTable-Empty:Record.EmptySlot~}
		<table class="mm-scan-table">
			<thead><tr>
				<th onclick="_Pict.views['Manager-ScanTable'].setSort('Module')">Module{~D:Record.Mark.Module~}</th>
				<th>Links</th>
				<th onclick="_Pict.views['Manager-ScanTable'].setSort('Branch')">Branch{~D:Record.Mark.Branch~}</th>
				<th class="num" onclick="_Pict.views['Manager-ScanTable'].setSort('Ahead')">↑{~D:Record.Mark.Ahead~}</th>
				<th class="num" onclick="_Pict.views['Manager-ScanTable'].setSort('Behind')">↓{~D:Record.Mark.Behind~}</th>
				<th onclick="_Pict.views['Manager-ScanTable'].setSort('Next')">Next{~D:Record.Mark.Next~}</th>
				<th onclick="_Pict.views['Manager-ScanTable'].setSort('Local')">Local{~D:Record.Mark.Local~}</th>
				<th onclick="_Pict.views['Manager-ScanTable'].setSort('Published')">Published (npm){~D:Record.Mark.Published~}</th>
				<th class="num" onclick="_Pict.views['Manager-ScanTable'].setSort('Source')">Src{~D:Record.Mark.Source~}</th>
				<th class="num" onclick="_Pict.views['Manager-ScanTable'].setSort('Tests')">Test{~D:Record.Mark.Tests~}</th>
				<th class="num" onclick="_Pict.views['Manager-ScanTable'].setSort('Docs')">Docs{~D:Record.Mark.Docs~}</th>
				<th class="num" onclick="_Pict.views['Manager-ScanTable'].setSort('Tooling')">Tool{~D:Record.Mark.Tooling~}</th>
			</tr></thead>
			<tbody>{~TS:Manager-ScanTable-Row:Record.Rows~}</tbody>
		</table>
	</div>
</div>`
			},
			{ Hash: 'Manager-ScanTable-Empty', Template: /*html*/`<div class="mm-scan-empty">No modules match — adjust the filters, or run a scan.</div>` },
			{
				Hash: 'Manager-ScanTable-Row',
				Template: /*html*/`<tr>
	<td><a class="mm-scan-name" href="#/Module/{~D:Record.NameEnc~}">{~D:Record.Name~}</a></td>
	<td class="mm-scan-links">{~TS:Manager-ScanTable-Gh:Record.GhSlot~}{~TS:Manager-ScanTable-Docs:Record.DocsSlot~}{~TS:Manager-ScanTable-Npm:Record.NpmSlot~}</td>
	<td>{~D:Record.Branch~}</td>
	<td class="num mm-scan-ab">{~D:Record.AheadDisplay~}</td>
	<td class="num mm-scan-ab">{~D:Record.BehindDisplay~}</td>
	<td><span class="{~D:Record.NextClass~}">{~D:Record.NextLabel~}</span></td>
	<td>{~D:Record.LocalVersion~}</td>
	<td><span class="{~D:Record.PublishedClass~}">{~D:Record.PublishedVersion~}</span></td>
	<td class="num">{~D:Record.Source~}</td>
	<td class="num">{~D:Record.Tests~}</td>
	<td class="num">{~D:Record.Docs~}</td>
	<td class="num">{~D:Record.Tooling~}</td>
</tr>`
			},
			{ Hash: 'Manager-ScanTable-Gh', Template: /*html*/`<a href="{~D:Record.Url~}" target="_blank" rel="noopener" title="GitHub" onclick="event.stopPropagation()">gh</a>` },
			{ Hash: 'Manager-ScanTable-Docs', Template: /*html*/`<a href="{~D:Record.Url~}" target="_blank" rel="noopener" title="Docs" onclick="event.stopPropagation()">docs</a>` },
			{ Hash: 'Manager-ScanTable-Npm', Template: /*html*/`<a href="{~D:Record.Url~}" target="_blank" rel="noopener" title="npm" onclick="event.stopPropagation()">npm</a>` }
		],
		Renderables:
		[
			{ RenderableHash: 'Manager-ScanTable-Content', TemplateHash: 'Manager-ScanTable-Content', ContentDestinationAddress: '#RM-Workspace-Content', RenderMethod: 'replace' }
		]
	};

module.exports = ManagerScanTableView;
