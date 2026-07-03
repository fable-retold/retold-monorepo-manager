const libPictView = require('pict-view');

/** Manager-StatusBar — a single status line at the bottom of the shell. */
class ManagerStatusBarView extends libPictView
{
	onAfterRender(pRenderable)
	{
		this.pict.CSSMap.injectCSS();
		return super.onAfterRender(pRenderable);
	}
}

ManagerStatusBarView.default_configuration =
	{
		// Mounted into Theme-BottomBar's status slot (BottomBar StatusView='Manager-StatusBar'). The
		// theme bar provides the surface; we render the status text into it.
		ViewIdentifier: 'Manager-StatusBar',
		DefaultRenderable: 'Manager-StatusBar-Content',
		DefaultDestinationAddress: '#Theme-BottomBar-Status',
		DefaultTemplateRecordAddress: 'AppData.Manager',
		AutoRender: false,
		CSS: /*css*/`
			.mm-statusbar { display: flex; align-items: center; height: 100%; font-size: 12px;
				font-family: var(--font-mono); color: var(--color-muted); }
		`,
		Templates:
		[
			{ Hash: 'Manager-StatusBar-Content', Template: /*html*/`<div class="mm-statusbar">{~D:Record.StatusMessage~}</div>` }
		],
		Renderables:
		[
			{ RenderableHash: 'Manager-StatusBar-Content', TemplateHash: 'Manager-StatusBar-Content', ContentDestinationAddress: '#Theme-BottomBar-Status', RenderMethod: 'replace' }
		]
	};

module.exports = ManagerStatusBarView;
