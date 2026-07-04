/**
 * Manager-TopBar-Nav — the app's primary navigation, dropped into the Theme-TopBar nav slot.
 *
 * Renders into `#Theme-TopBar-Nav` (the destination Theme-TopBar exposes for host nav content).
 * Theme-TopBar owns the brand mark, the user-area, and the theme button; this view owns only the
 * Home / Bulk-ops links + the server-health badge. Mounted automatically by Theme-TopBar via
 * `NavView: 'Manager-TopBar-Nav'` in the Theme-Section provider's ViewOptions.
 *
 * Theme-TopBar provides the nav *slot* + the active-item (`aria-current="page"`) style, but NOT the base
 * button chrome — so `.action` is styled in the app's own CSS (css/monorepo-manager.css). Without that the
 * buttons fall through to raw native OS button rendering (`appearance:auto`).
 */
const libPictView = require('pict-view');

const _ViewConfiguration =
{
	ViewIdentifier: 'Manager-TopBar-Nav',
	DefaultRenderable: 'Manager-TopBar-Nav-Content',
	DefaultDestinationAddress: '#Theme-TopBar-Nav',
	DefaultTemplateRecordAddress: 'AppData.Manager',
	AutoRender: false,
	CSS: /*css*/`
		.mm-topbar-nav { display: flex; align-items: center; gap: 8px; }
		.mm-topbar-nav-divider { width: 1px; align-self: stretch; margin: 6px 4px;
			background: var(--theme-color-border-default, #30363d); }
		.mm-svc-chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 4px 2px 9px;
			border-radius: 12px; font-size: 11px; line-height: 1.2; cursor: pointer; user-select: none;
			background: var(--theme-color-status-success-tint, rgba(63,185,80,0.12));
			color: var(--theme-color-status-success, #3fb950);
			border: 1px solid var(--theme-color-status-success, #3fb950); }
		.mm-svc-chip:hover { background: var(--theme-color-status-success, #3fb950); color: var(--theme-color-background-panel, #fff); }
		.mm-svc-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor;
			animation: mm-svc-pulse 1.6s infinite; }
		@keyframes mm-svc-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
		.mm-svc-label { font-family: var(--font-mono, monospace); white-space: nowrap; }
		.mm-svc-stop { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px;
			padding: 0; margin-left: 2px; background: transparent; color: inherit; border: 0; border-radius: 50%;
			cursor: pointer; font-size: 12px; line-height: 1; }
		.mm-svc-stop:hover { background: rgba(255,255,255,0.25); }
	`,
	CSSPriority: 500,
	Templates:
	[
		{
			Hash: 'Manager-TopBar-Nav-Template',
			Template: /*html*/`
<div class="mm-topbar-nav">
	<span class="badge {~D:Record.Health.state~}" title="server health">{~D:Record.Health.text~}</span>
	{~TS:Manager-TopBar-Nav-ServiceChip:Record.ServicesSlot~}
	<span class="mm-topbar-nav-divider"></span>
	<button class="action" aria-current="{~D:Record.IsHome~}" onclick="window.location.hash='#/Home'">Home</button>
	<button class="action" aria-current="{~D:Record.IsModules~}" onclick="window.location.hash='#/Modules'">Modules</button>
	<button class="action" aria-current="{~D:Record.IsBulk~}" onclick="window.location.hash='#/Bulk'">Bulk ops</button>
	<button class="action" aria-current="{~D:Record.IsManifest~}" onclick="window.location.hash='#/Manifest'">Manifest</button>
</div>`
		},
		{
			Hash: 'Manager-TopBar-Nav-ServiceChip',
			Template: /*html*/`<span class="mm-svc-chip" title="{~D:Record.Name~} running on port {~D:Record.Port~} — click to open" onclick="_Pict.views['Manager-TopBar-Nav'].openService('{~D:Record.KeyJs~}')"><span class="mm-svc-dot"></span><span class="mm-svc-label">{~D:Record.Name~}</span><button class="mm-svc-stop" title="Stop {~D:Record.Name~}" onclick="event.stopPropagation(); _Pict.views['Manager-TopBar-Nav'].stopService('{~D:Record.KeyJs~}')">✕</button></span>`
		}
	],
	Renderables:
	[
		{ RenderableHash: 'Manager-TopBar-Nav-Content', TemplateHash: 'Manager-TopBar-Nav-Template', DestinationAddress: '#Theme-TopBar-Nav', RenderMethod: 'replace' }
	]
};

class ManagerTopBarNavView extends libPictView
{
	onBeforeRender()
	{
		// Pict resolves the template Record (AppData.Manager) BEFORE onBeforeRender, so mutate the
		// addressed slot in place. aria-current plants "page" on exactly the active route's button
		// (empty elsewhere — the [aria-current="page"] selector in Theme-TopBar matches only "page").
		let tmpManager = this.pict.AppData.Manager || {};
		let tmpRoute = tmpManager.CurrentRoute || 'Home';
		tmpManager.IsHome = (tmpRoute === 'Home') ? 'page' : '';
		tmpManager.IsModules = (tmpRoute === 'Modules') ? 'page' : '';
		tmpManager.IsBulk = (tmpRoute === 'Bulk') ? 'page' : '';
		tmpManager.IsManifest = (tmpRoute === 'Manifest') ? 'page' : '';

		// Running supervised services → chips (config-driven; empty unless the manifest declares any).
		let tmpServices = tmpManager.Services || {};
		tmpManager.ServicesSlot = Object.keys(tmpServices)
			.filter((pKey) => tmpServices[pKey] && tmpServices[pKey].Running)
			.map((pKey) =>
				{
					let tmpService = tmpServices[pKey];
					let tmpUrl = tmpService.URL || (tmpService.Port ? 'http://localhost:' + tmpService.Port : '');
					return { Key: pKey, KeyJs: String(pKey).replace(/'/g, "\\'"), Name: tmpService.Name || pKey, Port: tmpService.Port || '', Url: tmpUrl };
				});
	}

	openService(pKey)
	{
		let tmpService = (this.pict.AppData.Manager.Services || {})[pKey];
		if (!tmpService) { return; }
		let tmpUrl = tmpService.URL || (tmpService.Port ? 'http://localhost:' + tmpService.Port : '');
		if (tmpUrl && typeof window !== 'undefined') { window.open(tmpUrl, '_blank', 'noopener'); }
	}

	stopService(pKey)
	{
		let tmpSelf = this;
		let tmpAPI = this.pict.providers.ManagerAPI;
		if (!tmpAPI || typeof tmpAPI.stopService !== 'function') { return; }
		tmpAPI.stopService(pKey).then(function () { if (tmpAPI.pollServices) { /* poll refresh */ } tmpSelf.pict.providers.ManagerAPI.loadServices().then(function (pResult) { tmpSelf.pict.AppData.Manager.Services = pResult.Services || {}; tmpSelf.render(); }).catch(function () {}); }).catch(function () {});
	}

	onAfterRender(pRenderable, pAddress, pRecord, pContent)
	{
		this.pict.CSSMap.injectCSS();
		return super.onAfterRender(pRenderable, pAddress, pRecord, pContent);
	}
}

module.exports = ManagerTopBarNavView;
module.exports.default_configuration = _ViewConfiguration;
