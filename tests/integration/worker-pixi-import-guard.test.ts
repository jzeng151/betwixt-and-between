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

// Files that legitimately import these — every +page.svelte / +layout.svelte
// (script tags are client-only when `export const ssr = false` is declared
// in the matching +page.ts/+layout.ts) is allowed; every
// src/lib/features/map/*.{svelte,ts} client module is allowed.
//
// Forbidden:
//   - Server endpoints: +server.{ts,js}, +page.server.{ts,js},
//     +layout.server.{ts,js}, hooks.server.{ts,js}
//   - Anything under src/lib/server/**
//   - Universal SvelteKit modules: +page.{ts,js} and +layout.{ts,js}.
//     Per SvelteKit semantics, universal modules execute server-side
//     during SSR unless ssr=false is declared. Pixi imports belong in
//     +page.svelte (script tag, client-only); +page.ts files exist to
//     declare ssr=false, not to import canvas libs. Codex PR54#5.
function isForbiddenPath(path: string): boolean {
	if (/\+server\.(ts|js)$/.test(path)) return true;
	if (/\+(page|layout)\.server\.(ts|js)$/.test(path)) return true;
	if (/hooks\.server\.(ts|js)$/.test(path)) return true;
	// Universal modules — server-risk by default.
	if (/\+(page|layout)\.(ts|js)$/.test(path)) return true;
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
				// Match common import forms:
				//   - `import … from 'mod'`
				//   - `await import('mod')`
				//   - `require('mod')`
				//   - `import 'mod'`            (side-effect, Codex PR54#4)
				//   - `import 'mod/sub'`        (side-effect for sub-modules)
				const patterns = [
					new RegExp(`from\\s+['"]${mod}(?:/[^'"]*)?['"]`),
					new RegExp(`import\\s*\\(\\s*['"]${mod}(?:/[^'"]*)?['"]`),
					new RegExp(`require\\s*\\(\\s*['"]${mod}(?:/[^'"]*)?['"]`),
					new RegExp(`^\\s*import\\s+['"]${mod}(?:/[^'"]*)?['"]`, 'm')
				];
				if (patterns.some((re) => re.test(contents))) {
					offenders.push({ file: rel, matched: mod });
				}
			}
		}

		expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
	});
});
