const libAssert = require('assert');
const libFS = require('fs');
const libPath = require('path');

const libManifestLoader = require('../source/core/Manager-Core-ManifestLoader.js');
const libManifestTools = require('../source/core/Manager-Core-ManifestTools.js');

const _ScratchRoot = libPath.join(__dirname, '.test_manifestloader');
const _ManifestPath = libPath.join(_ScratchRoot, 'Modules-Manifest.json');

function writePackage(pRelativeDir, pName, pDescription)
{
	let tmpDir = libPath.join(_ScratchRoot, pRelativeDir);
	libFS.mkdirSync(tmpDir, { recursive: true });
	libFS.writeFileSync(libPath.join(tmpDir, 'package.json'), JSON.stringify({ name: pName, version: '1.0.0', description: pDescription }));
}

function buildScratchMonorepo()
{
	libFS.rmSync(_ScratchRoot, { recursive: true, force: true });
	libFS.mkdirSync(_ScratchRoot, { recursive: true });

	// On disk:
	writePackage('modules/pict/alpha', 'alpha', 'Alpha module');
	writePackage('modules/pict/beta', 'beta', 'Beta module (on disk, NOT in manifest -> OnlyInDisk)');
	writePackage('services/gamma', 'gamma', 'Gamma service in a non-standard folder');
	// A noise dir that must be ignored by discovery.
	libFS.mkdirSync(libPath.join(_ScratchRoot, 'modules/pict/node_modules/junk'), { recursive: true });
	libFS.writeFileSync(libPath.join(_ScratchRoot, 'modules/pict/node_modules/junk/package.json'), '{}');

	// Manifest declares alpha (convention path), gamma (explicit non-standard Path), and delta (no dir -> OnlyInManifest).
	let tmpManifest =
	{
		SchemaVersion: '2.0',
		Name: 'Scratch',
		GitRemote: 'origin',
		DefaultBranch: 'main',
		Org: 'acme',
		GitTemplate: 'https://github.com/{org}/{name}.git',
		DocsTemplate: 'https://{org}.github.io/{name}/',
		EcosystemMembership: { Mode: 'manifest', Scopes: [] },
		Groups:
		[
			{
				Name: 'Pict',
				Description: 'MVC',
				Path: 'modules/pict',
				Discover: [ '*' ],
				ModuleMarker: 'package.json',
				Modules:
				[
					{ Name: 'alpha', Path: 'modules/pict/alpha', Type: 'library' },
					{ Name: 'gamma', Path: 'services/gamma', Type: 'service' },
					{ Name: 'delta', Path: 'modules/pict/delta', Type: 'library' }
				]
			}
		]
	};
	libFS.writeFileSync(_ManifestPath, JSON.stringify(tmpManifest, null, '\t'));
}

suite('ManifestLoader',
	() =>
	{
		suiteSetup(() => { buildScratchMonorepo(); });
		suiteTeardown(() => { libFS.rmSync(_ScratchRoot, { recursive: true, force: true }); });

		test('loads and indexes every declared module',
			() =>
			{
				let tmpLoader = new libManifestLoader({ ManifestPath: _ManifestPath });
				tmpLoader.load();
				libAssert.deepStrictEqual(tmpLoader.getAllModuleNames().sort(), [ 'alpha', 'delta', 'gamma' ]);
			});

		test('AbsolutePath: entry Path wins (service in a non-standard folder)',
			() =>
			{
				let tmpLoader = new libManifestLoader({ ManifestPath: _ManifestPath });
				tmpLoader.load();
				libAssert.strictEqual(tmpLoader.getModule('gamma').AbsolutePath, libPath.join(_ScratchRoot, 'services/gamma'));
				libAssert.strictEqual(tmpLoader.getModule('alpha').AbsolutePath, libPath.join(_ScratchRoot, 'modules/pict/alpha'));
			});

		test('repoRoot resolves to the manifest directory',
			() =>
			{
				let tmpLoader = new libManifestLoader({ ManifestPath: _ManifestPath });
				tmpLoader.load();
				libAssert.strictEqual(tmpLoader.getRepoRoot(), _ScratchRoot);
			});

		test('getConfig() surfaces defaults + manifest values',
			() =>
			{
				let tmpLoader = new libManifestLoader({ ManifestPath: _ManifestPath });
				let tmpConfig = tmpLoader.getConfig();
				libAssert.strictEqual(tmpConfig.GitRemote, 'origin');
				libAssert.strictEqual(tmpConfig.Org, 'acme');
				libAssert.strictEqual(tmpConfig.VersionSource, 'highest-in-repo');
			});

		test('isEcosystemDependency: manifest mode = manifest presence',
			() =>
			{
				let tmpLoader = new libManifestLoader({ ManifestPath: _ManifestPath });
				tmpLoader.load();
				libAssert.strictEqual(tmpLoader.isEcosystemDependency('alpha'), true);
				libAssert.strictEqual(tmpLoader.isEcosystemDependency('restify'), false);
			});

		test('isEcosystemDependency: scopes mode is additive and does not exclude manifest names by default',
			() =>
			{
				// Re-load with a scopes-mode override to prove the semantics.
				let tmpLoader = new libManifestLoader({ ManifestPath: _ManifestPath });
				tmpLoader.load();
				tmpLoader.raw.EcosystemMembership = { Mode: 'both', Scopes: [ '@acme/' ] };
				libAssert.strictEqual(tmpLoader.isEcosystemDependency('alpha'), true, 'manifest name still counts in both mode');
				libAssert.strictEqual(tmpLoader.isEcosystemDependency('@acme/widget'), true, 'scoped name counts in both mode');
				libAssert.strictEqual(tmpLoader.isEcosystemDependency('lodash'), false);
			});
	});

suite('ManifestTools (audit + backfill)',
	() =>
	{
		setup(() => { buildScratchMonorepo(); });
		suiteTeardown(() => { libFS.rmSync(_ScratchRoot, { recursive: true, force: true }); });

		test('audit reports on-disk and in-manifest drift, ignoring node_modules',
			() =>
			{
				let tmpLoader = new libManifestLoader({ ManifestPath: _ManifestPath });
				let tmpReport = libManifestTools.audit(tmpLoader);
				libAssert.strictEqual(tmpReport.HasDrift, true);
				libAssert.deepStrictEqual(tmpReport.OnlyInDisk.map((pX) => (pX.Name)).sort(), [ 'beta' ]);
				libAssert.deepStrictEqual(tmpReport.OnlyInManifest.map((pX) => (pX.Name)).sort(), [ 'delta' ]);
			});

		test('backfill --dry lists the missing on-disk module but writes nothing',
			() =>
			{
				let tmpLoader = new libManifestLoader({ ManifestPath: _ManifestPath });
				let tmpResult = libManifestTools.backfill(tmpLoader, { Write: false });
				libAssert.strictEqual(tmpResult.Written, false);
				libAssert.deepStrictEqual(tmpResult.Added.map((pX) => (pX.Name)), [ 'beta' ]);
				// Synthesized GitHub URL uses the template.
				libAssert.ok(tmpResult.ManifestText.indexOf('https://github.com/acme/beta.git') >= 0);
			});

		test('backfill --write persists the new entry (idempotent on re-run)',
			() =>
			{
				let tmpLoaderA = new libManifestLoader({ ManifestPath: _ManifestPath });
				let tmpFirst = libManifestTools.backfill(tmpLoaderA, { Write: true });
				libAssert.strictEqual(tmpFirst.Written, true);

				let tmpLoaderB = new libManifestLoader({ ManifestPath: _ManifestPath });
				tmpLoaderB.load();
				libAssert.ok(tmpLoaderB.getAllModuleNames().indexOf('beta') >= 0, 'beta persisted to the manifest');

				let tmpSecond = libManifestTools.backfill(tmpLoaderB, { Write: true });
				libAssert.strictEqual(tmpSecond.Added.length, 0, 'second backfill adds nothing');
			});
	});
