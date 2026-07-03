/**
 * MonorepoManager-CommandFactory
 *
 * Turns the declarative CommandMap into pict-service-commandlineutility command classes — one class
 * per CommandMap entry (one per noun). Every command accepts a variadic `[args...]` positional and
 * hands the raw tokens to the entry's Handler, which parses them (the calling convention — verb-first
 * like `manifest audit`, or module-first like `git <module> pull` — is the handler's business, not
 * the factory's). This keeps "each action from a simple map of commands" literally true: a new
 * command is one CommandMap entry + one handler.
 */
const libCommandLineCommand = require('pict-service-commandlineutility').ServiceCommandLineCommand;

/**
 * Normalize the arguments commander hands to an action into a joined positional string + the options
 * object. With a variadic `[args...]` positional commander passes the collected tokens as an ARRAY
 * in the first slot; the base runPromise (which keeps only string positionals) would drop it. This
 * flattens arrays so every token survives. Commander always passes (…positionals, options, command),
 * so the last two entries are the options object and the command.
 * @param {Array} pArguments
 * @returns {{ ArgumentString: string, Options: object }}
 */
function flattenCommanderArguments(pArguments)
{
	let tmpOptions = (pArguments.length >= 2) ? pArguments[pArguments.length - 2] : {};
	let tmpRaw = pArguments.slice(0, -2);
	let tmpPositionals = [];
	for (let i = 0; i < tmpRaw.length; i++)
	{
		let tmpValue = tmpRaw[i];
		if (Array.isArray(tmpValue))
		{
			for (let j = 0; j < tmpValue.length; j++)
			{
				if (typeof tmpValue[j] === 'string' && tmpValue[j].length > 0) { tmpPositionals.push(tmpValue[j]); }
			}
		}
		else if (typeof tmpValue === 'string' && tmpValue.length > 0)
		{
			tmpPositionals.push(tmpValue);
		}
	}
	return { ArgumentString: tmpPositionals.join(' '), Options: tmpOptions };
}

/**
 * @param {Array<object>} pCommandMap - The CommandMap entries.
 * @param {object} pShared - Shared context injected into every handler call (e.g. { Package }).
 * @returns {Array<Function>} Command classes for the CLIProgram constructor.
 */
function buildCommandClasses(pCommandMap, pShared)
{
	let tmpShared = pShared || {};
	return pCommandMap.map((pEntry) => (makeCommandClass(pEntry, tmpShared)));
}

function makeCommandClass(pEntry, pShared)
{
	// Union options declared on the entry and on each of its Verbs (dedupe by Name).
	let tmpOptions = [];
	let tmpSeen = new Set();
	function addOptions(pList)
	{
		let tmpList = pList || [];
		for (let i = 0; i < tmpList.length; i++)
		{
			if (!tmpSeen.has(tmpList[i].Name))
			{
				tmpSeen.add(tmpList[i].Name);
				tmpOptions.push(tmpList[i]);
			}
		}
	}
	addOptions(pEntry.Options);
	let tmpVerbs = pEntry.Verbs || [];
	for (let i = 0; i < tmpVerbs.length; i++) { addOptions(tmpVerbs[i].Options); }

	let tmpVerbNames = tmpVerbs.map((pVerb) => (pVerb.Verb));
	let tmpArgsDescription = (tmpVerbNames.length > 0)
		? `<verb> [target...] — verbs: ${tmpVerbNames.join(', ')}`
		: 'Command arguments.';

	let tmpDescription = pEntry.Description || pEntry.Keyword;

	return class GeneratedCommand extends libCommandLineCommand
	{
		constructor(pFable, pOptions, pServiceHash)
		{
			super(pFable, pOptions, pServiceHash);

			this.options.CommandKeyword = pEntry.Keyword;
			this.options.Description = tmpDescription;

			// One variadic positional accepts zero-or-more tokens for every command.
			this.options.CommandArguments.push({ Name: '[args...]', Description: tmpArgsDescription, Default: undefined });

			for (let i = 0; i < tmpOptions.length; i++)
			{
				this.options.CommandOptions.push(tmpOptions[i]);
			}

			this.addCommand();
		}

		// Override the library's runPromise: with a variadic `[args...]` positional, commander hands
		// the collected values as an ARRAY in the first slot, which the base runPromise (expecting
		// string positionals) filters away. Flatten arrays so the tokens survive into ArgumentString.
		async runPromise(...pArguments)
		{
			let tmpFlattened = flattenCommanderArguments(pArguments);
			return new Promise((pResolve, pReject) =>
			{
				this.runAsync(tmpFlattened.ArgumentString, tmpFlattened.Options,
					(pError, pResult) => (pError ? pReject(pError) : pResolve(pResult)));
			});
		}

		onRunAsync(fCallback)
		{
			let tmpArgumentString = (this.ArgumentString || '').trim();
			let tmpTokens = (tmpArgumentString.length > 0) ? tmpArgumentString.split(/\s+/) : [];

			let tmpContext =
			{
				Fable: this.fable,
				Log: this.log,
				Options: this.CommandOptions || {},
				Arguments: tmpTokens,
				ArgumentString: tmpArgumentString,
				Keyword: pEntry.Keyword,
				Package: pShared.Package,
				Program: this.fable,
				Entry: pEntry
			};

			return Promise.resolve().then(() => (pEntry.Handler(tmpContext))).then(
				() => (fCallback()),
				(pError) =>
				{
					this.log.error(`Command [${pEntry.Keyword}] failed: ${pError.message}`, { Stack: pError.stack });
					return fCallback(pError);
				});
		}
	};
}

module.exports = { buildCommandClasses, makeCommandClass, flattenCommanderArguments };
