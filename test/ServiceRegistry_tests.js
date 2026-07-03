const libAssert = require('assert');
const libFS = require('fs');
const libPath = require('path');

const libManifestLoader = require('../source/core/Manager-Core-ManifestLoader.js');
const libServer = require('../source/web_server/MonorepoManager-Server.js');

const _ScratchRoot = libPath.join(__dirname, '.test_serviceregistry');
const _ManifestPath = libPath.join(_ScratchRoot, 'Modules-Manifest.json');

suite('Server.buildServiceRegistry',
	() =>
	{
		suiteSetup(() =>
			{
				libFS.mkdirSync(libPath.join(_ScratchRoot, 'apps', 'api'), { recursive: true });
				libFS.writeFileSync(libPath.join(_ScratchRoot, 'apps', 'api', 'package.json'), '{"name":"api","version":"1.0.0"}');
				libFS.writeFileSync(_ManifestPath, JSON.stringify(
					{
						SchemaVersion: '2.0',
						Name: 'Svc Scratch',
						DevServers: { Docs: { Port: 43210, Command: 'npx docs serve {docsPath}' } },
						Groups:
						[
							{
								Name: 'Apps', Path: 'apps', Discover: [ '*' ], ModuleMarker: 'package.json',
								Modules:
								[
									{ Name: 'api', Path: 'apps/api', Type: 'service', Service: { Entry: 'source/App.js', Port: 8080, StartCommand: 'npm start' } },
									{ Name: 'lib', Path: 'apps/lib', Type: 'library' }
								]
							}
						]
					}, null, '\t'));
			});
		suiteTeardown(() => { libFS.rmSync(_ScratchRoot, { recursive: true, force: true }); });

		test('registers a service per module Service block, plus each DevServer',
			() =>
			{
				let tmpLoader = new libManifestLoader({ ManifestPath: _ManifestPath });
				let tmpRegistry = libServer.buildServiceRegistry(tmpLoader);

				let tmpKeys = Object.keys(tmpRegistry).sort();
				libAssert.deepStrictEqual(tmpKeys, [ 'api', 'devserver:Docs' ]);

				libAssert.strictEqual(tmpRegistry.api.Command, 'npm start');
				libAssert.strictEqual(tmpRegistry.api.Port, 8080);
				libAssert.ok(tmpRegistry.api.Cwd.endsWith('apps/api'), 'module service Cwd is its AbsolutePath');

				libAssert.strictEqual(tmpRegistry['devserver:Docs'].Command, 'npx docs serve {docsPath}');
				libAssert.strictEqual(tmpRegistry['devserver:Docs'].Cwd, '{modulePath}');
			});

		test('a plain library (no Service block) is not registered',
			() =>
			{
				let tmpLoader = new libManifestLoader({ ManifestPath: _ManifestPath });
				let tmpRegistry = libServer.buildServiceRegistry(tmpLoader);
				libAssert.strictEqual(tmpRegistry.lib, undefined);
			});
	});
