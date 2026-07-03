const libPictApplication = require('pict-application');
const libPictSectionModal = require('pict-section-modal');
const libPictSectionTheme = require('pict-section-theme');

const libBrand = require('./MonorepoManager-Brand.js');

const libProviderAPI = require('./providers/Pict-Provider-Manager-API.js');
const libProviderWS = require('./providers/Pict-Provider-Manager-OperationsWS.js');
const libProviderBulk = require('./providers/Pict-Provider-Manager-Bulk.js');

const libViewLayout = require('./views/PictView-Manager-Layout.js');
const libViewTopBarNav = require('./views/PictView-Manager-TopBar-Nav.js');
const libViewTopBarUser = require('./views/PictView-Manager-TopBar-User.js');
const libViewStatusBar = require('./views/PictView-Manager-StatusBar.js');
const libViewOutputPanel = require('./views/PictView-Manager-OutputPanel.js');
const libViewModuleList = require('./views/PictView-Manager-ModuleList.js');
const libViewHome = require('./views/PictView-Manager-Home.js');
const libViewWorkspace = require('./views/PictView-Manager-ModuleWorkspace.js');
const libViewBulkWizard = require('./views/PictView-Manager-BulkWizard.js');
const libViewManifestEditor = require('./views/PictView-Manager-ManifestEditor.js');
const libViewScanTable = require('./views/PictView-Manager-ScanTable.js');

/**
 * MonorepoManager-Application — the pict browser app. Registers providers + views, builds the shell,
 * wires hash routing (#/Home, #/Module/:name), and kicks the boot data loads + operation stream.
 */
class MonorepoManagerApplication extends libPictApplication
{
	constructor(pFable, pOptions, pServiceHash)
	{
		super(pFable, pOptions, pServiceHash);

		let tmpPict = this.pict;

		// Providers first (views reach them at construction).
		tmpPict.addProvider('ManagerAPI', libProviderAPI.default_configuration, libProviderAPI);
		tmpPict.addProvider('ManagerOperationsWS', libProviderWS.default_configuration, libProviderWS);
		tmpPict.addProvider('ManagerBulk', libProviderBulk.default_configuration, libProviderBulk);

		// The dock/modal engine.
		tmpPict.addView('Pict-Section-Modal', {}, libPictSectionModal);

		// Theme-TopBar / Theme-BottomBar slot views — MUST be registered BEFORE Theme-Section, which
		// looks them up by hash when wiring the shared chrome.
		tmpPict.addView('Manager-TopBar-Nav', libViewTopBarNav.default_configuration, libViewTopBarNav);
		tmpPict.addView('Manager-TopBar-User', libViewTopBarUser.default_configuration, libViewTopBarUser);
		tmpPict.addView('Manager-StatusBar', libViewStatusBar.default_configuration, libViewStatusBar);

		// Theme section — one addProvider wires the pict-provider-theme runtime, the bundled theme
		// catalog, the Picker/ModeToggle/ScaleSelect/Button views, the shared Theme-TopBar (BrandMark
		// + our Nav/User slots + theme button) and Theme-BottomBar (our StatusBar slot), theme/mode/
		// scale persistence, and the --brand-color-* vars from our Brand block. Defaults to
		// pict-default in system mode; the retold-manager theme (and every other) is one click away in
		// the picker. Heights match the panel Sizes in Manager-Layout's addPanel() calls.
		tmpPict.addProvider('Theme-Section',
			{
				ApplyDefault: 'pict-default',
				DefaultMode: 'system',
				DefaultScale: 1.0,
				Brand: libBrand,
				Views: ['Picker', 'ModeToggle', 'ScaleSelect', 'Button', 'BrandMark', 'TopBar', 'BottomBar'],
				ViewOptions:
				{
					TopBar: { NavView: 'Manager-TopBar-Nav', UserView: 'Manager-TopBar-User', Height: 56 },
					BottomBar: { StatusView: 'Manager-StatusBar', Height: 26 }
				}
			}, libPictSectionTheme);

		// Shell + content views.
		tmpPict.addView('Manager-Layout', libViewLayout.default_configuration, libViewLayout);
		tmpPict.addView('Manager-OutputPanel', libViewOutputPanel.default_configuration, libViewOutputPanel);
		tmpPict.addView('Manager-ModuleList', libViewModuleList.default_configuration, libViewModuleList);
		tmpPict.addView('Manager-Home', libViewHome.default_configuration, libViewHome);
		tmpPict.addView('Manager-ModuleWorkspace', libViewWorkspace.default_configuration, libViewWorkspace);
		tmpPict.addView('Manager-BulkWizard', libViewBulkWizard.default_configuration, libViewBulkWizard);
		tmpPict.addView('Manager-ManifestEditor', libViewManifestEditor.default_configuration, libViewManifestEditor);
		tmpPict.addView('Manager-ScanTable', libViewScanTable.default_configuration, libViewScanTable);
	}

	/** Re-render the topbar nav slot (health / active-route highlight are data-driven). */
	renderTopBar()
	{
		let tmpNav = this.pict.views['Manager-TopBar-Nav'];
		if (tmpNav && typeof tmpNav.render === 'function') { tmpNav.render(); }
	}

	_buildAppData()
	{
		let tmpDock = 'side';
		try { tmpDock = window.localStorage.getItem('mm:dock') || 'side'; } catch (pError) { /* ignore */ }
		let tmpSortByTime = false;
		try { tmpSortByTime = window.localStorage.getItem('mm:sortByTime') === '1'; } catch (pError) { /* ignore */ }
		let tmpRecent = [];
		try { let tmpRaw = window.localStorage.getItem('mm:recent'); if (tmpRaw) { let tmpList = JSON.parse(tmpRaw); if (Array.isArray(tmpList)) { tmpRecent = tmpList.filter((pN) => typeof pN === 'string').slice(0, 100); } } } catch (pError) { /* ignore */ }

		this.pict.AppData.Manager =
			{
				StatusMessage: 'Ready',
				Health: { state: '?', text: '…' },
				CurrentRoute: 'Home',
				Modules: [],
				ModulesByGroup: {},
				Scan: { Results: {}, When: null, Running: false },
				Services: {},
				ModuleListQuery: '',
				DockPosition: tmpDock,
				SortByTime: tmpSortByTime,
				RecentModules: tmpRecent,
				SelectedModule: null,
				SelectedModuleDetail: null,
				ActiveOperation: { OperationId: null, Lines: [], HeaderState: 'idle', HeaderText: 'idle', ModuleName: null },
				ActionHistory: [],
				Bulk: { Step: 'choose', Catalog: [], SelectedType: null, TargetMode: 'all', SelectedTargets: {}, Params: {}, Plan: null, PlanError: null, RunHash: null, Run: null, Paused: null, RunError: null },
				// Stable derived-record objects — views MUTATE these in onBeforeRender (pict captures the
				// record reference before onBeforeRender, so replacing them would render one step behind).
				Manifest: null,
				ModuleListRecord: {},
				ModuleWorkspaceRecord: {},
				HomeRecord: {},
				OutputRecord: {},
				BulkRecord: {},
				ManifestRecord: {},
				ScanRecord: {}
			};
	}

	showModule(pName)
	{
		this.pict.AppData.Manager.CurrentRoute = 'Module';
		this._touchRecentModule(pName);
		this.pict.views['Manager-ModuleWorkspace'].loadModule(pName);
		this.renderTopBar();
	}

	/** Move-to-front MRU tracking (drives the module list's "sort by time"). */
	_touchRecentModule(pName)
	{
		if (!pName) { return; }
		let tmpList = this.pict.AppData.Manager.RecentModules || [];
		tmpList = [ pName ].concat(tmpList.filter((pN) => pN !== pName)).slice(0, 100);
		this.pict.AppData.Manager.RecentModules = tmpList;
		try { window.localStorage.setItem('mm:recent', JSON.stringify(tmpList)); } catch (pError) { /* quota */ }
	}

	showHome()
	{
		this.pict.AppData.Manager.CurrentRoute = 'Home';
		this.pict.AppData.Manager.SelectedModule = null;
		this.pict.views['Manager-Home'].render();
		let tmpList = this.pict.views['Manager-ModuleList']; if (tmpList) { tmpList.render(); }
		this.renderTopBar();
	}

	showBulk()
	{
		this.pict.AppData.Manager.CurrentRoute = 'Bulk';
		if (!this.pict.AppData.Manager.Bulk.Catalog || this.pict.AppData.Manager.Bulk.Catalog.length === 0)
		{
			this.pict.providers.ManagerBulk.loadCatalog();
		}
		this.pict.views['Manager-BulkWizard'].render();
		this.renderTopBar();
	}

	showManifest()
	{
		this.pict.AppData.Manager.CurrentRoute = 'Manifest';
		this.pict.AppData.Manager.SelectedModule = null;
		this.pict.views['Manager-ManifestEditor'].reload();
		this.renderTopBar();
	}

	showModules()
	{
		this.pict.AppData.Manager.CurrentRoute = 'Modules';
		this.pict.AppData.Manager.SelectedModule = null;
		this.pict.views['Manager-ScanTable'].render();
		// Kick a scan if we don't have results yet.
		let tmpScan = this.pict.AppData.Manager.Scan;
		if (!tmpScan || !tmpScan.Results || Object.keys(tmpScan.Results).length === 0)
		{
			this.pict.providers.ManagerAPI.scanAllModules().catch(() => {});
		}
		this.renderTopBar();
	}

	onAfterInitializeAsync(fCallback)
	{
		if (typeof window !== 'undefined' && !window.pict) { window.pict = this.pict; }

		this._buildAppData();

		let tmpSelf = this;
		function route()
		{
			let tmpHash = (window.location.hash || '').replace(/^#\/?/, '');
			let tmpParts = tmpHash.split('/');
			if (tmpParts[0] === 'Module' && tmpParts[1]) { tmpSelf.showModule(decodeURIComponent(tmpParts[1])); }
			else if (tmpParts[0] === 'Bulk') { tmpSelf.showBulk(); }
			else if (tmpParts[0] === 'Manifest') { tmpSelf.showManifest(); }
			else if (tmpParts[0] === 'Modules') { tmpSelf.showModules(); }
			else { tmpSelf.showHome(); }
		}
		window.addEventListener('hashchange', route);

		// Build the shell (Layout render synchronously creates panels + auto-renders their ContentViews),
		// then render the manual-placement views.
		this.pict.views['Manager-Layout'].render();
		this.pict.views['Manager-ModuleList'].render();

		route();

		let tmpAPI = this.pict.providers.ManagerAPI;
		tmpAPI.loadModules().then(() => tmpAPI.scanAllModules()).catch(() => {});
		tmpAPI.pollHealth();
		tmpAPI.pollServices();
		this.pict.providers.ManagerOperationsWS.connect();

		return super.onAfterInitializeAsync(fCallback);
	}
}

MonorepoManagerApplication.default_configuration = require('./MonorepoManager-Application-Configuration.json');

module.exports = MonorepoManagerApplication;
