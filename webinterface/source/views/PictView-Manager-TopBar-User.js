/**
 * Manager-TopBar-User — the app's user-area chrome, dropped into the Theme-TopBar user slot.
 *
 * Renders into `#Theme-TopBar-User`. Sits between the nav actions and the theme button (which
 * Theme-TopBar auto-mounts to the far right). Hosts the "Output" toggle for the bottom output panel
 * and an npm-cache utilities menu. Mounted automatically by Theme-TopBar via
 * `UserView: 'Manager-TopBar-User'` in the Theme-Section provider's ViewOptions. The `.action` class
 * is Theme-TopBar's — themed for free.
 */
const libPictView = require('pict-view');

const _ViewConfiguration =
{
	ViewIdentifier: 'Manager-TopBar-User',
	DefaultRenderable: 'Manager-TopBar-User-Content',
	DefaultDestinationAddress: '#Theme-TopBar-User',
	AutoRender: false,
	CSS: /*css*/`
		.mm-topbar-user { display: flex; align-items: center; gap: 8px; }
	`,
	CSSPriority: 500,
	Templates:
	[
		{
			Hash: 'Manager-TopBar-User-Template',
			Template: /*html*/`
<div class="mm-topbar-user">
	<button class="action" title="npm cache utilities" onclick="_Pict.views['Manager-TopBar-User'].openCacheMenu(this); event.stopPropagation();">Cache ▾</button>
	<button class="action" title="Toggle the output panel" onclick="_Pict.views['Manager-Layout'].popOutputPanel()">Output</button>
</div>`
		}
	],
	Renderables:
	[
		{ RenderableHash: 'Manager-TopBar-User-Content', TemplateHash: 'Manager-TopBar-User-Template', DestinationAddress: '#Theme-TopBar-User', RenderMethod: 'replace' }
	]
};

class ManagerTopBarUserView extends libPictView
{
	onAfterRender(pRenderable, pAddress, pRecord, pContent)
	{
		this.pict.CSSMap.injectCSS();
		return super.onAfterRender(pRenderable, pAddress, pRecord, pContent);
	}

	openCacheMenu(pAnchor)
	{
		let tmpModal = this.pict.views['Pict-Section-Modal'];
		if (!tmpModal || typeof tmpModal.dropdown !== 'function') { return; }
		let tmpSelf = this;
		tmpModal.dropdown(pAnchor,
			{
				align: 'right',
				items:
				[
					{ Hash: 'verify', Label: 'npm cache verify', Title: 'Check the local npm cache integrity and report orphaned/garbage entries.' },
					{ Hash: 'clean', Label: 'force clean npm cache', Title: 'Runs `npm cache clean --force` — wipes the local cache. Use when publishes return stale tarballs or integrity errors.' }
				]
			}).then(function (pChoice)
			{
				if (pChoice && pChoice.Hash) { tmpSelf._runCache(pChoice.Hash); }
			});
	}

	_runCache(pAction)
	{
		let tmpLabel = (pAction === 'clean') ? 'npm cache clean --force' : 'npm cache verify';
		let tmpWS = this.pict.providers.ManagerOperationsWS;
		let tmpAPI = this.pict.providers.ManagerAPI;
		// Route through the WS chokepoint so it queues behind any running op and streams into the panel.
		tmpWS.enqueueOperation(function ()
			{
				tmpWS.beginOperation(tmpLabel, null);
				tmpAPI.runNpmCacheOperation(pAction).catch(function () {});
			}, { Label: tmpLabel });
	}
}

module.exports = ManagerTopBarUserView;
module.exports.default_configuration = _ViewConfiguration;
