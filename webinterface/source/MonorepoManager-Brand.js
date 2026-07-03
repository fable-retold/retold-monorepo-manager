/**
 * MonorepoManager-Brand — the application's wordmark / signature.
 *
 * Handed to pict-section-theme as the `Brand` block on the Theme-Section provider. Drives:
 *   - The Theme-BrandMark view in the topbar (icon + name)
 *   - --brand-color-* CSS variables that themes / app CSS reference
 *   - The Favicon / FaviconDark SVGs available via the theme provider
 *
 * The brand is precomputed at build time into package.json under `retold.brand` by the
 * `pict-section-theme-brand` CLI; this file just re-exports that block. To change the look:
 *
 *   1. Re-run the brand CLI (standalone mode):
 *        node node_modules/pict-section-theme/bin/pict-section-theme-brand.js \
 *          --package package.json --palette <key> --display-name "Monorepo Manager" --tagline "…"
 *   2. Rebuild the bundle (`npx quack build`).
 *
 * Curated palette keys: mix, default, desert, ocean, forest, synthwave, twilight, cosmos, carnival.
 * Precomputing keeps the LogoGenerator dependency out of the runtime bundle and makes every brand
 * change an auditable package.json diff.
 */
const tmpPackage = require('../package.json');

if (!tmpPackage.retold || !tmpPackage.retold.brand)
{
	throw new Error('monorepo-manager: package.json is missing retold.brand — '
		+ 'run the pict-section-theme-brand CLI before building');
}

module.exports = tmpPackage.retold.brand;
