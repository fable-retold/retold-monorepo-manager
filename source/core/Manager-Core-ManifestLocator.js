/**
 * Manager-Core-ManifestLocator
 *
 * Finds and loads a monorepo's Modules-Manifest.json. Git-style: when no explicit
 * path is given it walks UP the directory tree from a starting directory until it
 * finds the manifest (or hits the filesystem root). This is what lets `mm` run from
 * anywhere inside a monorepo without a --manifest flag.
 *
 * Deliberately dependency-free (no pict / no fable) so it is trivially unit-testable
 * and usable from any layer — the full ManifestLoader (Phase 1) is built on top of it.
 */
const libFS = require('fs');
const libPath = require('path');

const DEFAULT_MANIFEST_FILENAME = 'Modules-Manifest.json';

class ManifestLocator
{
	/**
	 * Walk up from pStartDirectory looking for pFileName.
	 *
	 * @param {string} [pStartDirectory] - Directory to start from (default: process.cwd()).
	 * @param {string} [pFileName] - Manifest filename to look for (default: Modules-Manifest.json).
	 * @return {string|false} Absolute path to the manifest, or false if none was found.
	 */
	static locate(pStartDirectory, pFileName)
	{
		let tmpFileName = pFileName || DEFAULT_MANIFEST_FILENAME;
		let tmpDirectory = libPath.resolve(pStartDirectory || process.cwd());

		// Guard against a pathological loop; the fs root check below is the real terminator.
		for (let i = 0; i < 512; i++)
		{
			let tmpCandidate = libPath.join(tmpDirectory, tmpFileName);
			if (libFS.existsSync(tmpCandidate))
			{
				return tmpCandidate;
			}

			let tmpParent = libPath.dirname(tmpDirectory);
			if (tmpParent === tmpDirectory)
			{
				// Reached the filesystem root without finding it.
				return false;
			}
			tmpDirectory = tmpParent;
		}

		return false;
	}

	/**
	 * Resolve + read + parse a manifest.
	 *
	 * @param {string} [pPathOrStart] - An explicit manifest file path, a directory to search from,
	 *                                  or falsy to search from process.cwd().
	 * @param {string} [pFileName] - Manifest filename to look for when searching.
	 * @return {{ Path: string, Manifest: object }|false} The loaded manifest and its path, or false.
	 */
	static load(pPathOrStart, pFileName)
	{
		let tmpPath = pPathOrStart;

		// If we weren't handed an existing FILE, treat the argument as a search start directory.
		if (!tmpPath || !libFS.existsSync(tmpPath) || libFS.statSync(tmpPath).isDirectory())
		{
			tmpPath = ManifestLocator.locate(tmpPath, pFileName);
		}

		if (!tmpPath)
		{
			return false;
		}

		let tmpContent = libFS.readFileSync(tmpPath, 'utf8');
		return { Path: tmpPath, Manifest: JSON.parse(tmpContent) };
	}
}

ManifestLocator.DEFAULT_MANIFEST_FILENAME = DEFAULT_MANIFEST_FILENAME;

module.exports = ManifestLocator;
