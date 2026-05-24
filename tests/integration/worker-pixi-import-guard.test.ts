/**
 * Δ1b-H — Worker-side Paper.js + Pixi.js import guard.
 *
 * `wrangler.jsonc` declares `nodejs_compat` but Cloudflare Workers do not
 * have native `canvas`. Anything that imports `paper` or `pixi.js` into
 * the SSR/Worker bundle fails at runtime (or, worse, silently bloats the
 * bundle past Workers' 1 MB compressed limit).
 *
 * This test asserts the modules are only imported from client-side files —
 * `+page.svelte`, `+page.ts` (with ssr=false), and `src/lib/features/map/`
 * client modules. A future top-level import that leaks into a +server.ts,
 * a +layout.server.ts, or any non-feature-map server module triggers the
 * test.
 *
 * Pairs with the Vite Worker-build size budget (Δ1b-G) — they catch the
 * same class of regression at different layers (static grep vs. compiled
 * bundle size).
 */

import { describe, it, expect } from 'vitest';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const FORBIDDEN_IMPORTS = ['pixi.js', 'svelte-pixi', 'paper'];

// Files that legitimately import these — every +page.svelte / +page.ts / +layout.svelte
// that mounts Pixi is allowed; every src/lib/features/map/*.svelte and ts client
// module is allowed. Server endpoints (+server.ts, +layout.server.ts, hooks.server.ts)
// and all of src/lib/server/** are forbidden.
function isForbiddenPath(path: string): boolean {
	// Worker / SSR entry points
	if (/\+server\.ts$/.test(path)) return true;
	if (/\+layout\.server\.(ts|js)$/.test(path)) return true;
	if (/hooks\.server\.(ts|js)$/.test(path)) return true;
	// Anything under src/lib/server/**
	if (/^src\/lib\/server\//.test(path)) return true;
	return false;
}

async function walk(dir: string, results: string[] = []): Promise<string[]> {
	const entries = await readdir(dir);
	for (const entry of entries) {
		const full = join(dir, entry);
		const s = await stat(full);
		if (s.isDirectory()) {
			if (entry === 'node_modules' || entry.startsWith('.')) continue;
			await walk(full, results);
		} else if (s.isFile()) {
			if (/\.(ts|js|svelte)$/.test(entry)) results.push(full);
		}
	}
	return results;
}

describe('Δ1b-H — Worker-side Pixi/Paper import guard', () => {
	it('no server-side file imports pixi.js, svelte-pixi, or paper', async () => {
		const files = await walk('src');
		const offenders: Array<{ file: string; matched: string }> = [];

		for (const file of files) {
			const rel = file.replace(/^.*?\/(src\/)/, '$1');
			if (!isForbiddenPath(rel)) continue;

			const contents = await readFile(file, 'utf8');
			for (const mod of FORBIDDEN_IMPORTS) {
				// Match common import forms: `import … from 'mod'`,
				// `await import('mod')`, `require('mod')`.
				const patterns = [
					new RegExp(`from\\s+['"]${mod}['"]`),
					new RegExp(`import\\s*\\(\\s*['"]${mod}['"]`),
					new RegExp(`require\\s*\\(\\s*['"]${mod}['"]`)
				];
				if (patterns.some((re) => re.test(contents))) {
					offenders.push({ file: rel, matched: mod });
				}
			}
		}

		expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
	});
});
