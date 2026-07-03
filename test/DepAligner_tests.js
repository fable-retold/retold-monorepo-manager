const libAssert = require('assert');
const libFS = require('fs');
const libPath = require('path');

const libManifestLoader = require('../source/core/Manager-Core-ManifestLoader.js');
const libDepAligner = require('../source/core/Manager-Core-DepAligner.js');

const _ScratchRoot = libPath.join(__dirname, '.test_depaligner');
const _ManifestPath = libPath.join(_ScratchRoot, 'Modules-Manifest.json');

function writePackage(pRelativeDir, pPackage)
{
	let tmpDir = libPath.join(_ScratchRoot, pRelativeDir);
	libFS.mkdirSync(tmpDir, { recursive: true });
	libFS.writeFileSync(libPath.join(tmpDir, 'package.json'), JSON.stringify(pPackage, null, '\t'));
}

function buildScratch()
{
	libFS.rmSync(_ScratchRoot, { recursive: true, force: true });
	libFS.mkdirSync(_ScratchRoot, { recursive: true });

	writePackage('modules/a', { name: 'a', version: '2.0.0' });
	writePackage('modules/b',
		{
			name: 'b',
			version: '1.0.0',
			dependencies: { a: '^1.0.0', restify: '^8.0.0' },
			devDependencies: { a: 'file:../a' }
		});

	libFS.writeFileSync(_ManifestPath, JSON.stringify(
		{
			SchemaVersion: '2.0',
			Name: 'DepAlign Scratch',
			VersionSource: 'highest-in-repo',
			EcosystemMembership: { Mode: 'manifest', Scopes: [] },
			Groups:
			[
				{
					Name: 'Modules', Path: 'modules', Discover: [ '*' ], ModuleMarker: 'package.json',
					Modules: [ { Name: 'a', Path: 'modules/a' }, { Name: 'b', Path: 'modules/b' } ]
				}
			]
		}, null, '\t'));
}

suite('DepAligner',
	() =>
	{
		setup(() => { buildScratch(); });
		suiteTeardown(() => { libFS.rmSync(_ScratchRoot, { recursive: true, force: true }); });

		test('aligns an ecosystem dep to the highest-in-repo version, skipping externals and file: links',
			() =>
			{
				let tmpLoader = new libManifestLoader({ ManifestPath: _ManifestPath });
				let tmpResult = libDepAligner.align(tmpLoader, { Write: false });

				libAssert.strictEqual(tmpResult.Changes.length, 1, 'exactly one change (b -> a)');
				let tmpChange = tmpResult.Changes[0];
				libAssert.strictEqual(tmpChange.Module, 'b');
				libAssert.strictEqual(tmpChange.Dependency, 'a');
				libAssert.strictEqual(tmpChange.From, '^1.0.0');
				libAssert.strictEqual(tmpChange.To, '^2.0.0');
				libAssert.strictEqual(tmpResult.Written, false);
			});

		test('--write persists the change and is then idempotent; file: link untouched',
			() =>
			{
				let tmpLoaderA = new libManifestLoader({ ManifestPath: _ManifestPath });
				let tmpFirst = libDepAligner.align(tmpLoaderA, { Write: true });
				libAssert.strictEqual(tmpFirst.Written, true);

				let tmpPackageB = JSON.parse(libFS.readFileSync(libPath.join(_ScratchRoot, 'modules/b/package.json'), 'utf8'));
				libAssert.strictEqual(tmpPackageB.dependencies.a, '^2.0.0', 'dependency aligned');
				libAssert.strictEqual(tmpPackageB.dependencies.restify, '^8.0.0', 'external dependency untouched');
				libAssert.strictEqual(tmpPackageB.devDependencies.a, 'file:../a', 'file: link untouched');

				let tmpLoaderB = new libManifestLoader({ ManifestPath: _ManifestPath });
				let tmpSecond = libDepAligner.align(tmpLoaderB, { Write: true });
				libAssert.strictEqual(tmpSecond.Changes.length, 0, 'second run is a no-op');
			});

		test('compareSemver orders versions correctly',
			() =>
			{
				libAssert.strictEqual(libDepAligner.compareSemver('2.0.0', '1.9.9'), 1);
				libAssert.strictEqual(libDepAligner.compareSemver('1.0.0', '1.0.0'), 0);
				libAssert.strictEqual(libDepAligner.compareSemver('1.2.0', '1.10.0'), -1);
			});
	});
