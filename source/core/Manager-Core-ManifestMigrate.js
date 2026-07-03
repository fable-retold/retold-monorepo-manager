/**
 * Manager-Core-ManifestMigrate
 *
 * Converts a retold-style v1 manifest ({ Generated, Description, GitHubOrg, Groups[] } with
 * per-module Forkable / Owner fork fields) into the generic v2 Modules-Manifest.json schema:
 * drops the fork fields, lifts GitHubOrg → Org (+ URL templates), seeds GroupOrder from the
 * existing group order, and adds the config blocks the new tool expects. This is what lets
 * retold's own 195-entry manifest bootstrap the generic tool.
 */
const DROPPED_MODULE_FIELDS = [ 'Forkable', 'Owner' ];

class ManifestMigrate
{
	/**
	 * @param {object} pV1Raw - The parsed v1 manifest.
	 * @param {object} [pOptions] - { Name, DefaultBranch }
	 * @returns {{ Manifest: object, Stats: { Groups, Modules, DroppedFields } }}
	 */
	static migrate(pV1Raw, pOptions)
	{
		let tmpOptions = pOptions || {};
		let tmpV1 = pV1Raw || {};
		let tmpGroups = Array.isArray(tmpV1.Groups) ? tmpV1.Groups : [];

		let tmpV2 =
		{
			SchemaVersion: '2.0',
			Name: tmpOptions.Name || tmpV1.Name || tmpV1.Description || 'Migrated Monorepo',
			Description: tmpV1.Description || '',

			RepoRoot: null,
			GitRemote: 'origin',
			DefaultBranch: tmpOptions.DefaultBranch || 'main',

			Org: tmpV1.Org || tmpV1.GitHubOrg || null,
			GitTemplate: tmpV1.GitTemplate || 'https://github.com/{org}/{name}.git',
			DocsTemplate: tmpV1.DocsTemplate || 'https://{org}.github.io/{name}/',

			EcosystemMembership: { Mode: 'manifest', Scopes: [] },

			Ripple:
			{
				GroupOrder: tmpGroups.map((pGroup) => (pGroup.Name)),
				ConsumerBump: 'patch',
				ProducerBump: 'patch',
				WaitForIndex: true,
				ProducerActions: [ 'preflight-clean-tree', 'bump-if-needed', 'publish', 'wait-for-index', 'commit-final', 'push' ],
				ConsumerActions: [ 'preflight-clean-tree', 'update-dep', 'install', 'test', 'commit', 'bump', 'publish', 'wait-for-index', 'commit-final', 'push' ]
			},

			VersionSource: 'highest-in-repo',

			Docs: { Path: 'docs', Engine: null },
			Logging: { LogFilePrefix: 'Monorepo-Manager-Operations-', LogDir: '.', Sink: 'file' },
			Auth: { Enabled: false, Provider: null },
			WebServer: { Port: 44444, Host: '127.0.0.1' },

			Groups: []
		};

		let tmpStats = { Groups: 0, Modules: 0, DroppedFields: 0 };

		for (let i = 0; i < tmpGroups.length; i++)
		{
			let tmpGroup = tmpGroups[i];
			let tmpNewGroup =
			{
				Name: tmpGroup.Name,
				Description: tmpGroup.Description || '',
				Path: tmpGroup.Path || null,
				Discover: [ '*' ],
				ModuleMarker: 'package.json',
				Modules: []
			};

			let tmpModules = Array.isArray(tmpGroup.Modules) ? tmpGroup.Modules : [];
			for (let j = 0; j < tmpModules.length; j++)
			{
				let tmpModule = tmpModules[j];
				let tmpNewModule = {};
				let tmpKeys = Object.keys(tmpModule);
				for (let k = 0; k < tmpKeys.length; k++)
				{
					if (DROPPED_MODULE_FIELDS.indexOf(tmpKeys[k]) >= 0)
					{
						tmpStats.DroppedFields++;
						continue;
					}
					tmpNewModule[tmpKeys[k]] = tmpModule[tmpKeys[k]];
				}
				tmpNewGroup.Modules.push(tmpNewModule);
				tmpStats.Modules++;
			}

			tmpV2.Groups.push(tmpNewGroup);
			tmpStats.Groups++;
		}

		return { Manifest: tmpV2, Stats: tmpStats };
	}
}

module.exports = ManifestMigrate;
module.exports.DROPPED_MODULE_FIELDS = DROPPED_MODULE_FIELDS;
