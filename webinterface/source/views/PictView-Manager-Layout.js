const libPictView = require('pict-view');

/**
 * Manager-Layout — the app shell, built on pict-section-modal's dock shell.
 *
 * Panels: topbar (top), statusbar + output + moduledock (bottom, stacked), sidebar (left), and the
 * center workspace. The movable module list lives in EITHER the left `sidebar` dock (compact) or the
 * bottom `moduledock` dock (wide); expandDock() flips which is shown. The other panels stay put.
 */
class ManagerLayoutView extends libPictView
{
	onAfterRender(pRenderable)
	{
		if (!this._shellBuilt)
		{
			this._buildShell();
			this._shellBuilt = true;
		}
		this.pict.CSSMap.injectCSS();
		return super.onAfterRender(pRenderable);
	}

	_buildShell()
	{
		let tmpModalSection = this.pict.views['Pict-Section-Modal'];
		if (!tmpModalSection || typeof tmpModalSection.shell !== 'function')
		{
			this.pict.log.warn('Manager-Layout: pict-section-modal.shell not available.');
			return;
		}
		let tmpMount = document.getElementById('RM-Layout-Mount');
		if (!tmpMount) { this.pict.log.warn('Manager-Layout: #RM-Layout-Mount not in DOM.'); return; }

		this._shell = tmpModalSection.shell(tmpMount, { PersistenceKey: 'monorepo-manager' });

		// Top + bottom = the shared pict-section-theme chrome. Theme-TopBar fills the top with the
		// BrandMark + our Nav/User slot views + the theme button; Theme-BottomBar fills the bottom
		// with our StatusBar slot. Heights match the Theme-Section ViewOptions.
		this._shell.addPanel({ Hash: 'topbar', Side: 'top', Mode: 'fixed', Size: 56, ContentDestinationId: 'Theme-TopBar', ContentView: 'Theme-TopBar' });
		this._shell.addPanel({ Hash: 'statusbar', Side: 'bottom', Mode: 'fixed', Size: 26, MinSize: 20, ContentDestinationId: 'Theme-BottomBar', ContentView: 'Theme-BottomBar' });
		this._shell.addPanel({ Hash: 'output', Side: 'bottom', Mode: 'resizable', Size: 180, MinSize: 80, MaxSize: 600, Collapsed: false, Title: 'Output', ContentDestinationId: 'RM-Output-Content', ContentView: 'Manager-OutputPanel' });
		this._shell.addPanel({ Hash: 'moduledock', Side: 'bottom', Mode: 'resizable', Size: 260, MinSize: 120, MaxSize: 600, Collapsed: true, Title: 'Modules', ContentDestinationId: 'RM-Bottom-Dock', OnExpand: () => this._onDockExpand('bottom') });
		this._shell.addPanel({ Hash: 'sidebar', Side: 'left', Mode: 'resizable', Size: 300, MinSize: 220, MaxSize: 520, Collapsed: false, Title: 'Modules', ContentDestinationId: 'RM-Side-Dock', ResponsiveDrawer: 900, OnExpand: () => this._onDockExpand('side') });

		this._shell.getCenterEl().innerHTML = '<div id="RM-Workspace"><div id="RM-Workspace-Content"></div></div>';
	}

	/** Show the module list in the requested dock; hide it in the other. */
	expandDock(pPosition)
	{
		if (!this._shell) { return; }
		let tmpSide = this._shell.getPanel('sidebar');
		let tmpBottom = this._shell.getPanel('moduledock');
		if (pPosition === 'side')
		{
			if (tmpSide) { tmpSide.expand(); }
			if (tmpBottom) { tmpBottom.collapse(); }
		}
		else
		{
			if (tmpBottom) { tmpBottom.expand(); }
			if (tmpSide) { tmpSide.collapse(); }
		}
	}

	/**
	 * A dock panel was expanded — via its collapse tab or programmatically. Expanding a dock is an
	 * implicit "show the modules here", so route the single module-list view into THIS dock: flip
	 * DockPosition, collapse the other dock, and re-render. Without this, expanding the inactive dock
	 * (whose content toggleDock cleared, and which has no ContentView) would reveal an empty drawer.
	 */
	_onDockExpand(pPosition)
	{
		if (this._dockExpanding) { return; } // guard re-entrancy from expandDock()/toggleDock()
		this._dockExpanding = true;
		try
		{
			let tmpManager = this.pict.AppData.Manager;
			if (tmpManager.DockPosition !== pPosition)
			{
				tmpManager.DockPosition = pPosition;
				try { window.localStorage.setItem('mm:dock', pPosition); } catch (pError) { /* ignore */ }
				let tmpOther = (pPosition === 'side') ? this._shell.getPanel('moduledock') : this._shell.getPanel('sidebar');
				if (tmpOther && !tmpOther.Collapsed) { tmpOther.collapse(); }
				// Clear the vacated dock so no stale (hidden) copy lingers — matches toggleDock().
				let tmpVacated = (pPosition === 'side') ? '#RM-Bottom-Dock' : '#RM-Side-Dock';
				this.pict.ContentAssignment.assignContent(tmpVacated, '');
			}
			let tmpList = this.pict.views['Manager-ModuleList'];
			if (tmpList && typeof tmpList.render === 'function') { tmpList.render(); }
		}
		finally { this._dockExpanding = false; }
	}

	popOutputPanel()
	{
		if (this._shell) { this._shell.openPanel('output'); }
	}
}

ManagerLayoutView.default_configuration =
	{
		ViewIdentifier: 'Manager-Layout',
		DefaultRenderable: 'Manager-Layout-Shell',
		DefaultDestinationAddress: '#MonorepoManager-Application-Container',
		AutoRender: false,
		CSS: /*css*/`
			/* height:100% (not 100vh) cascades correctly under Theme-Scale's CSS zoom on <html>. */
			html, body { height: 100%; margin: 0; }
			#MonorepoManager-Application-Container { height: 100%; min-height: 0; overflow: hidden; }
			#RM-Layout-Mount { height: 100%; }
			/* Shell-managed surfaces follow the active theme. */
			.pict-modal-shell        { background: var(--color-bg); }
			.pict-modal-shell-panel  { background: var(--color-panel); }
			.pict-modal-shell-center { background: var(--color-bg); }
		`,
		Templates:
		[
			{ Hash: 'Manager-Layout-Shell', Template: '<div id="RM-Layout-Mount"></div>' }
		],
		Renderables:
		[
			{ RenderableHash: 'Manager-Layout-Shell', TemplateHash: 'Manager-Layout-Shell', ContentDestinationAddress: '#MonorepoManager-Application-Container', RenderMethod: 'replace' }
		]
	};

module.exports = ManagerLayoutView;
