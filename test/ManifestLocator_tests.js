const libAssert = require('assert');
const libFS = require('fs');
const libPath = require('path');

const libManifestLocator = require('../source/core/Manager-Core-ManifestLocator.js');

const _ScratchRoot = libPath.join(__dirname, '.test_manifestlocator');
const _NestedDirectory = libPath.join(_ScratchRoot, 'group', 'module');
const _ManifestPath = libPath.join(_ScratchRoot, 'Modules-Manifest.json');

suite('ManifestLocator',
	() =>
	{
		suiteSetup(
			() =>
			{
				libFS.mkdirSync(_NestedDirectory, { recursive: true });
				libFS.writeFileSync(_ManifestPath, JSON.stringify(
					{
						SchemaVersion: '2.0',
						Name: 'Scratch Monorepo',
						Groups:
						[
							{ Name: 'G', Modules: [ { Name: 'alpha' }, { Name: 'beta' } ] }
						]
					}));
			});

		suiteTeardown(
			() =>
			{
				libFS.rmSync(_ScratchRoot, { recursive: true, force: true });
			});

		test('locate() walks up from a nested directory to the manifest',
			() =>
			{
				let tmpFound = libManifestLocator.locate(_NestedDirectory);
				libAssert.strictEqual(tmpFound, _ManifestPath);
			});

		test('load() from a nested directory returns the parsed manifest and its path',
			() =>
			{
				let tmpResult = libManifestLocator.load(_NestedDirectory);
				libAssert.ok(tmpResult, 'expected a result object');
				libAssert.strictEqual(tmpResult.Path, _ManifestPath);
				libAssert.strictEqual(tmpResult.Manifest.Name, 'Scratch Monorepo');
				libAssert.strictEqual(tmpResult.Manifest.Groups[0].Modules.length, 2);
			});

		test('load() accepts an explicit file path',
			() =>
			{
				let tmpResult = libManifestLocator.load(_ManifestPath);
				libAssert.ok(tmpResult);
				libAssert.strictEqual(tmpResult.Path, _ManifestPath);
			});

		test('locate() returns false when the file is never found',
			() =>
			{
				let tmpFound = libManifestLocator.locate(_NestedDirectory, 'Definitely-Not-A-Manifest-xyz.json');
				libAssert.strictEqual(tmpFound, false);
			});
	});
