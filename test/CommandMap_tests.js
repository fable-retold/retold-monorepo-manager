const libAssert = require('assert');

const libCommandMap = require('../source/cli/MonorepoManager-CommandMap.cjs');
const libCommandFactory = require('../source/cli/MonorepoManager-CommandFactory.cjs');

const _ValidTransports = [ 'native', 'web-only', 'mode-divergent' ];

suite('CommandMap',
	() =>
	{
		test('is a non-empty array',
			() =>
			{
				libAssert.ok(Array.isArray(libCommandMap), 'CommandMap must be an array');
				libAssert.ok(libCommandMap.length > 0, 'CommandMap must not be empty');
			});

		test('every entry has a Keyword, a valid Transport, and a Handler function',
			() =>
			{
				for (let i = 0; i < libCommandMap.length; i++)
				{
					let tmpEntry = libCommandMap[i];
					libAssert.ok(tmpEntry.Keyword, `entry ${i} is missing Keyword`);
					libAssert.ok(_ValidTransports.indexOf(tmpEntry.Transport) >= 0, `entry ${i} (${tmpEntry.Keyword}) has invalid Transport: ${tmpEntry.Transport}`);
					libAssert.strictEqual(typeof tmpEntry.Handler, 'function', `entry ${i} (${tmpEntry.Keyword}) Handler must be a function`);
				}
			});

		test('exposes the health command',
			() =>
			{
				let tmpHealth = libCommandMap.find((pEntry) => (pEntry.Keyword === 'health'));
				libAssert.ok(tmpHealth, 'expected a health command entry');
				libAssert.strictEqual(tmpHealth.Transport, 'native');
			});

		test('exposes the expected command verbs',
			() =>
			{
				let tmpKeywords = libCommandMap.map((pEntry) => (pEntry.Keyword));
				[ 'health', 'status', 'show', 'run', 'git', 'version', 'deps', 'all', 'publish', 'manifest' ].forEach((pKeyword) =>
				{
					libAssert.ok(tmpKeywords.indexOf(pKeyword) >= 0, `expected a '${pKeyword}' command`);
				});
			});

		test('every Verb (where present) has a valid Transport',
			() =>
			{
				libCommandMap.forEach((pEntry) =>
				{
					(pEntry.Verbs || []).forEach((pVerb) =>
					{
						libAssert.ok(pVerb.Verb, `${pEntry.Keyword} verb missing name`);
						libAssert.ok(_ValidTransports.indexOf(pVerb.Transport) >= 0, `${pEntry.Keyword} ${pVerb.Verb} invalid Transport`);
					});
				});
			});

		test('factory builds one command class per entry',
			() =>
			{
				let tmpClasses = libCommandFactory.buildCommandClasses(libCommandMap, { Package: { name: 'test', version: '0.0.0' } });
				libAssert.ok(Array.isArray(tmpClasses), 'expected an array of classes');
				libAssert.strictEqual(tmpClasses.length, libCommandMap.length, 'one class per entry');
				libAssert.strictEqual(typeof tmpClasses[0], 'function', 'each built command must be a class/constructor');
			});
	});

suite('CommandFactory.flattenCommanderArguments',
	() =>
	{
		function fakeCommand() { return { name: () => 'x' }; }

		test('flattens a variadic [args...] array into a joined positional string',
			() =>
			{
				let tmpResult = libCommandFactory.flattenCommanderArguments([ [ 'a', 'b', 'c' ], { manifest: '/x' }, fakeCommand() ]);
				libAssert.strictEqual(tmpResult.ArgumentString, 'a b c');
				libAssert.deepStrictEqual(tmpResult.Options, { manifest: '/x' });
			});

		test('handles the no-argument case',
			() =>
			{
				let tmpResult = libCommandFactory.flattenCommanderArguments([ { fetch: true }, fakeCommand() ]);
				libAssert.strictEqual(tmpResult.ArgumentString, '');
				libAssert.deepStrictEqual(tmpResult.Options, { fetch: true });
			});

		test('ignores empty variadic arrays',
			() =>
			{
				let tmpResult = libCommandFactory.flattenCommanderArguments([ [], {}, fakeCommand() ]);
				libAssert.strictEqual(tmpResult.ArgumentString, '');
			});
	});
