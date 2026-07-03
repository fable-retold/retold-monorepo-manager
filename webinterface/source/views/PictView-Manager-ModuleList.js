const libPictView = require('pict-view');
const libScanState = require('../MonorepoManager-ScanState.js');

/**
 * Manager-ModuleList — ONE list, two projections, movable between docks.
 *
 * DockPosition 'side' → compact list (name + action dot) in the left dock.
 * DockPosition 'bottom' → wide sortable table in the bottom dock.
 * The header's move button flips DockPosition (persisted to localStorage); a single renderable
 * re-targets its template + destination each render. Both projections read the same scan data and
 * navigate via the `#/Module/:name` hash route.
 */
function badgeClass(pBadge)
{
	return pBadge ? pBadge : '';
}

class ManagerModuleListView extends libPictView
{
	onBeforeRender(pRenderable)
	{
		let tmpManager = this.pict.AppData.Manager;
		let tmpDock = tmpManager.DockPosition || 'side';
		let tmpQuery = (tmpManager.ModuleListQuery || '').toLowerCase();
		let tmpScan = tmpManager.Scan.Results || {};
		let tmpModules = tmpManager.Modules || [];

		let tmpRows = [];
		for (let i = 0; i < tmpModules.length; i++)
		{
			let tmpModule = tmpModules[i];
			if (tmpQuery && tmpModule.Name.toLowerCase().indexOf(tmpQuery) < 0) { continue; }
			let tmpEntry = tmpScan[tmpModule.Name] || {};
			let tmpBadge = libScanState.badgeState(tmpEntry);
			let tmpNext = libScanState.nextAction(tmpEntry);
			let tmpAhead = tmpEntry.Ahead || 0;
			let tmpBehind = tmpEntry.Behind || 0;
			tmpRows.push(
				{
					Name: tmpModule.Name,
					NameEnc: encodeURIComponent(tmpModule.Name),
					Group: tmpModule.Group || 'Ungrouped',
					Branch: tmpEntry.Branch || '',
					AheadBehind: (tmpAhead ? '↑' + tmpAhead : '') + (tmpBehind ? '↓' + tmpBehind : '') || '·',
					NextActionShort: (tmpNext && tmpNext !== 'in-sync') ? tmpNext : '',
					Local: tmpEntry.LocalVersion || '',
					Published: tmpEntry.PublishedVersion || '',
					SelectedClass: (tmpManager.SelectedModule === tmpModule.Name) ? 'mm-row-selected' : '',
					BadgeSlot: tmpBadge ? [ { Badge: badgeClass(tmpBadge), Tip: libScanState.actionMeta(tmpEntry).Tip } ] : []
				});
		}

		let tmpSortByTime = !!tmpManager.SortByTime;
		let tmpGroups;
		if (tmpSortByTime)
		{
			// Flat, most-recently-opened first (then the rest in manifest order).
			let tmpRecent = tmpManager.RecentModules || [];
			let tmpRank = {};
			for (let i = 0; i < tmpRecent.length; i++) { tmpRank[tmpRecent[i]] = i; }
			let tmpSorted = tmpRows.slice().sort((pA, pB) =>
				{
					let tmpRa = (pA.Name in tmpRank) ? tmpRank[pA.Name] : Infinity;
					let tmpRb = (pB.Name in tmpRank) ? tmpRank[pB.Name] : Infinity;
					return tmpRa - tmpRb;
				});
			tmpGroups = [ { Name: 'BY RECENT USE', Rows: tmpSorted } ];
		}
		else
		{
			let tmpGroupsMap = {};
			let tmpOrder = [];
			for (let i = 0; i < tmpRows.length; i++)
			{
				if (!tmpGroupsMap[tmpRows[i].Group]) { tmpGroupsMap[tmpRows[i].Group] = []; tmpOrder.push(tmpRows[i].Group); }
				tmpGroupsMap[tmpRows[i].Group].push(tmpRows[i]);
			}
			tmpGroups = tmpOrder.map((pName) => ({ Name: pName, Rows: tmpGroupsMap[pName] }));
		}

		// Mutate the stable record in place (see Application._buildAppData).
		Object.assign(tmpManager.ModuleListRecord,
			{
				DockPosition: tmpDock,
				DockToggleLabel: (tmpDock === 'side') ? 'dock ↓' : 'dock ←',
				SortByTime: tmpSortByTime,
				SortToggleClass: tmpSortByTime ? 'is-active' : '',
				SortToggleTitle: tmpSortByTime ? 'Sorting by recent use — click for grouped view' : 'Sort by most-recently-opened',
				Query: tmpManager.ModuleListQuery || '',
				ScanMeta: tmpManager.Scan.Running ? 'scanning…' : (tmpRows.length + ' modules'),
				Rows: tmpRows,
				Groups: tmpGroups
			});

		if (tmpDock === 'bottom')
		{
			pRenderable.TemplateHash = 'Manager-ModuleList-Wide';
			pRenderable.ContentDestinationAddress = '#RM-Bottom-Dock';
		}
		else
		{
			pRenderable.TemplateHash = 'Manager-ModuleList-Compact';
			pRenderable.ContentDestinationAddress = '#RM-Side-Dock';
		}

		return super.onBeforeRender(pRenderable);
	}

	onAfterRender(pRenderable)
	{
		let tmpDock = this.pict.AppData.Manager.DockPosition || 'side';
		if (!this._dockSynced)
		{
			this._dockSynced = true;
			let tmpLayout = this.pict.views['Manager-Layout'];
			if (tmpLayout && typeof tmpLayout.expandDock === 'function') { tmpLayout.expandDock(tmpDock); }
		}
		if (this._restoreFocus)
		{
			this._restoreFocus = false;
			let tmpInput = document.getElementById('mm-ml-search');
			if (tmpInput) { tmpInput.focus(); tmpInput.setSelectionRange(tmpInput.value.length, tmpInput.value.length); }
		}
		this.pict.CSSMap.injectCSS();
		return super.onAfterRender(pRenderable);
	}

	setQuery(pValue)
	{
		this.pict.AppData.Manager.ModuleListQuery = pValue;
		this._restoreFocus = true;
		this.render();
	}

	scan()
	{
		let tmpAPI = this.pict.providers.ManagerAPI;
		if (tmpAPI) { tmpAPI.scanAllModules().catch(() => {}); }
	}

	toggleSort()
	{
		let tmpNext = !this.pict.AppData.Manager.SortByTime;
		this.pict.AppData.Manager.SortByTime = tmpNext;
		try { window.localStorage.setItem('mm:sortByTime', tmpNext ? '1' : '0'); } catch (pError) { /* ignore */ }
		this.render();
	}

	toggleDock()
	{
		let tmpCurrent = this.pict.AppData.Manager.DockPosition || 'side';
		let tmpNext = (tmpCurrent === 'side') ? 'bottom' : 'side';
		this.pict.AppData.Manager.DockPosition = tmpNext;
		try { window.localStorage.setItem('mm:dock', tmpNext); } catch (pError) { /* ignore */ }

		// Clear the vacated dock so no stale copy lingers.
		let tmpVacated = (tmpCurrent === 'side') ? '#RM-Side-Dock' : '#RM-Bottom-Dock';
		this.pict.ContentAssignment.assignContent(tmpVacated, '');

		let tmpLayout = this.pict.views['Manager-Layout'];
		if (tmpLayout && typeof tmpLayout.expandDock === 'function') { tmpLayout.expandDock(tmpNext); }
		this.render();
	}
}

ManagerModuleListView.default_configuration =
	{
		ViewIdentifier: 'Manager-ModuleList',
		DefaultRenderable: 'Manager-ModuleList-Renderable',
		DefaultTemplateRecordAddress: 'AppData.Manager.ModuleListRecord',
		AutoRender: false,
		Templates:
		[
			{
				Hash: 'Manager-ModuleList-Compact',
				Template: /*html*/`
<div class="mm-modulelist">
	<div class="mm-modulelist-header">
		<input id="mm-ml-search" placeholder="filter…" value="{~D:Record.Query~}" oninput="_Pict.views['Manager-ModuleList'].setQuery(this.value)">
		<button class="mm-btn" title="Rescan" onclick="_Pict.views['Manager-ModuleList'].scan()">↻</button>
		<button class="mm-btn {~D:Record.SortToggleClass~}" title="{~D:Record.SortToggleTitle~}" onclick="_Pict.views['Manager-ModuleList'].toggleSort()">time</button>
		<button class="mm-btn" title="Move the list" onclick="_Pict.views['Manager-ModuleList'].toggleDock()">{~D:Record.DockToggleLabel~}</button>
	</div>
	<div class="mm-grouphdr">{~D:Record.ScanMeta~}</div>
	{~TS:Manager-ModuleList-Group:Record.Groups~}
</div>`
			},
			{
				Hash: 'Manager-ModuleList-Group',
				Template: /*html*/`<div class="mm-grouphdr">{~D:Record.Name~}</div>{~TS:Manager-ModuleList-CompactRow:Record.Rows~}`
			},
			{
				Hash: 'Manager-ModuleList-CompactRow',
				Template: /*html*/`
<a class="mm-row {~D:Record.SelectedClass~}" href="#/Module/{~D:Record.NameEnc~}">
	<span class="mm-name">{~D:Record.Name~}</span>
	{~TS:Manager-ModuleList-Badge:Record.BadgeSlot~}
	<span class="mm-cell">{~D:Record.NextActionShort~}</span>
</a>`
			},
			{
				Hash: 'Manager-ModuleList-Badge',
				Template: /*html*/`<span class="mm-badge mm-badge-{~D:Record.Badge~}" title="{~D:Record.Tip~}"></span>`
			},
			{
				Hash: 'Manager-ModuleList-Wide',
				Template: /*html*/`
<div class="mm-modulelist">
	<div class="mm-modulelist-header">
		<input id="mm-ml-search" placeholder="filter…" value="{~D:Record.Query~}" oninput="_Pict.views['Manager-ModuleList'].setQuery(this.value)">
		<button class="mm-btn" title="Rescan" onclick="_Pict.views['Manager-ModuleList'].scan()">↻ scan</button>
		<button class="mm-btn {~D:Record.SortToggleClass~}" title="{~D:Record.SortToggleTitle~}" onclick="_Pict.views['Manager-ModuleList'].toggleSort()">time</button>
		<button class="mm-btn" title="Move the list" onclick="_Pict.views['Manager-ModuleList'].toggleDock()">{~D:Record.DockToggleLabel~}</button>
		<span class="mm-cell">{~D:Record.ScanMeta~}</span>
	</div>
	<table class="mm-table">
		<thead><tr><th>Module</th><th>Branch</th><th>±origin</th><th>Next</th><th>Local</th><th>Published</th></tr></thead>
		<tbody>{~TS:Manager-ModuleList-WideRow:Record.Rows~}</tbody>
	</table>
</div>`
			},
			{
				Hash: 'Manager-ModuleList-WideRow',
				Template: /*html*/`
<tr onclick="window.location.hash='#/Module/{~D:Record.NameEnc~}'">
	<td>{~D:Record.Name~}</td><td>{~D:Record.Branch~}</td><td class="mm-cell-num">{~D:Record.AheadBehind~}</td>
	<td>{~D:Record.NextActionShort~}</td><td>{~D:Record.Local~}</td><td>{~D:Record.Published~}</td>
</tr>`
			}
		],
		Renderables:
		[
			{ RenderableHash: 'Manager-ModuleList-Renderable', TemplateHash: 'Manager-ModuleList-Compact', ContentDestinationAddress: '#RM-Side-Dock', RenderMethod: 'replace' }
		]
	};

module.exports = ManagerModuleListView;
