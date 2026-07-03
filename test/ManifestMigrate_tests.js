const libAssert = require('assert');

const libManifestMigrate = require('../source/core/Manager-Core-ManifestMigrate.js');

const _V1Manifest =
{
	Generated: '2025-01-01',
	Description: 'Retold ecosystem',
	GitHubOrg: 'fable-retold',
	Groups:
	[
		{
			Name: 'Pict',
			Description: 'MVC tools',
			Path: 'modules/pict',
			Modules:
			[
				{ Name: 'pict', Path: 'modules/pict/pict', Type: 'library', Owner: 'fable-retold', Forkable: true, GitHub: 'https://github.com/fable-retold/pict.git' },
				{ Name: 'pict-section-form', Path: 'modules/pict/pict-section-form', Type: 'library', Owner: 'stevenvelozo', Forkable: false }
			]
		},
		{
			Name: 'Fable',
			Description: 'Core',
			Path: 'modules/fable',
			Modules: [ { Name: 'fable', Path: 'modules/fable/fable', Type: 'library', Forkable: true, Owner: 'fable-retold' } ]
		}
	]
};

suite('ManifestMigrate',
	() =>
	{
		test('produces a v2 manifest',
			() =>
			{
				let tmpResult = libManifestMigrate.migrate(_V1Manifest, {});
				libAssert.strictEqual(tmpResult.Manifest.SchemaVersion, '2.0');
			});

		test('lifts GitHubOrg -> Org and keeps the URL template',
			() =>
			{
				let tmpResult = libManifestMigrate.migrate(_V1Manifest, {});
				libAssert.strictEqual(tmpResult.Manifest.Org, 'fable-retold');
				libAssert.strictEqual(tmpResult.Manifest.GitTemplate, 'https://github.com/{org}/{name}.git');
			});

		test('drops every Forkable / Owner field',
			() =>
			{
				let tmpResult = libManifestMigrate.migrate(_V1Manifest, {});
				let tmpText = JSON.stringify(tmpResult.Manifest);
				libAssert.strictEqual(tmpText.indexOf('Forkable'), -1, 'no Forkable fields remain');
				libAssert.strictEqual(tmpText.indexOf('Owner'), -1, 'no Owner fields remain');
				libAssert.strictEqual(tmpResult.Stats.DroppedFields, 6, 'dropped Forkable + Owner from all 3 modules');
			});

		test('seeds GroupOrder from the source group order and preserves module data',
			() =>
			{
				let tmpResult = libManifestMigrate.migrate(_V1Manifest, {});
				libAssert.deepStrictEqual(tmpResult.Manifest.Ripple.GroupOrder, [ 'Pict', 'Fable' ]);
				libAssert.strictEqual(tmpResult.Stats.Groups, 2);
				libAssert.strictEqual(tmpResult.Stats.Modules, 3);
				// A retained module keeps its GitHub + Type.
				let tmpPict = tmpResult.Manifest.Groups[0].Modules.find((pM) => (pM.Name === 'pict'));
				libAssert.strictEqual(tmpPict.GitHub, 'https://github.com/fable-retold/pict.git');
				libAssert.strictEqual(tmpPict.Type, 'library');
			});

		test('honors a DefaultBranch override',
			() =>
			{
				let tmpResult = libManifestMigrate.migrate(_V1Manifest, { DefaultBranch: 'master' });
				libAssert.strictEqual(tmpResult.Manifest.DefaultBranch, 'master');
			});
	});
