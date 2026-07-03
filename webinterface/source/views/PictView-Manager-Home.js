const libPictView = require('pict-view');
const libScanState = require('../MonorepoManager-ScanState.js');

/** Manager-Home — the default center view: a small dashboard. */
class ManagerHomeView extends libPictView
{
	onBeforeRender(pRenderable)
	{
		let tmpManager = this.pict.AppData.Manager;
		let tmpModules = tmpManager.Modules || [];
		let tmpScan = tmpManager.Scan.Results || {};
		let tmpDirty = 0;
		Object.keys(tmpScan).forEach((pName) => { if (libScanState.needsAction(tmpScan[pName])) { tmpDirty++; } });
		Object.assign(this.pict.AppData.Manager.HomeRecord, { ModuleCount: tmpModules.length, DirtyCount: tmpDirty });
		return super.onBeforeRender(pRenderable);
	}

	onAfterRender(pRenderable)
	{
		this.pict.CSSMap.injectCSS();
		return super.onAfterRender(pRenderable);
	}
}

ManagerHomeView.default_configuration =
	{
		ViewIdentifier: 'Manager-Home',
		DefaultRenderable: 'Manager-Home-Content',
		DefaultDestinationAddress: '#RM-Workspace-Content',
		DefaultTemplateRecordAddress: 'AppData.Manager.HomeRecord',
		AutoRender: false,
		Templates:
		[
			{
				Hash: 'Manager-Home-Content',
				Template: /*html*/`
<div class="mm-home">
	<h2>Monorepo Manager</h2>
	<p class="mm-muted">Pick a module from the list to see its status and actions. Use the “dock” button on the list to move it between the side and the bottom.</p>
	<div style="margin:22px 0">
		<span class="mm-stat"><span class="n">{~D:Record.ModuleCount~}</span><span class="l">modules</span></span>
		<span class="mm-stat"><span class="n">{~D:Record.DirtyCount~}</span><span class="l">need action</span></span>
	</div>
	<div class="mm-actions">
		<button class="mm-btn mm-btn-primary" onclick="_Pict.views['Manager-ModuleList'].scan()">Rescan all</button>
	</div>
</div>`
			}
		],
		Renderables:
		[
			{ RenderableHash: 'Manager-Home-Content', TemplateHash: 'Manager-Home-Content', ContentDestinationAddress: '#RM-Workspace-Content', RenderMethod: 'replace' }
		]
	};

module.exports = ManagerHomeView;
