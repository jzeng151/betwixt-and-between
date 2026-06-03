/**
 * Generate the `--color-type-*` block in src/app.css from the single TS source
 * of truth, `ENTITY_TYPE_HEX` (src/lib/entity-type-colors.ts). Settings
 * customization Phase 2, Item 1 / CQ1.
 *
 * The world map cascade (style-cascade.ts) needs resolved hex in TS; the DOM
 * consumers (graph/wiki/timeline) read the same colors via `var(--color-type-*)`
 * from app.css. To keep the two from silently drifting, app.css is GENERATED
 * from the TS constant — same generator-with-sentinels pattern as
 * docs:schema/docs:api/docs:edges.
 *
 *   npm run gen:palette-css           # rewrite the block in src/app.css
 *   npm run gen:palette-css -- --check # exit 1 if the committed block drifted
 *
 * A unit test (tests/unit/palette-css-drift.test.ts) also asserts equality, so
 * the drift guard runs in the normal `npm test` / CI path without extra wiring.
 *
 * Only the 8 EntityType vars are owned here. `--color-type-door` is NOT an
 * EntityType (legacy portal var) and lives just below the END sentinel,
 * untouched.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ENTITY_TYPE_HEX } from '../src/lib/entity-type-colors.js';
import type { EntityType } from '../src/lib/server/db/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const APP_CSS_PATH = resolve(__dirname, '../src/app.css');

export const BEGIN_SENTINEL = '  /* BEGIN GENERATED: color-type (npm run gen:palette-css) */';
export const END_SENTINEL = '  /* END GENERATED: color-type */';

/** Descriptive prose per type (NOT a value source — the hex comes from ENTITY_TYPE_HEX). */
const COMMENTS: Record<EntityType, string> = {
	Character: 'amber — protagonist accent',
	Location: 'forest green — earth/place',
	Event: 'magenta — pivotal beat',
	Act: 'deep violet — structural',
	Scene: 'sky blue — moment',
	Note: 'warm grey — annotation',
	Artifact: 'burnt orange — fictional object',
	Item: 'gold — inventory item'
};

/** Render the sentinel-wrapped CSS block (no trailing newline). */
export function renderPaletteCssBlock(): string {
	const entries = Object.entries(ENTITY_TYPE_HEX) as [EntityType, string][];
	const longest = Math.max(...entries.map(([t]) => `--color-type-${t.toLowerCase()}:`.length));
	const lines = entries.map(([type, hex]) => {
		const decl = `--color-type-${type.toLowerCase()}:`;
		const pad = ' '.repeat(longest - decl.length + 1);
		return `  ${decl}${pad}${hex};  /* ${COMMENTS[type]} */`;
	});
	return [BEGIN_SENTINEL, ...lines, END_SENTINEL].join('\n');
}

/** Replace the existing generated block in `css` with a freshly rendered one. */
export function applyBlock(css: string): string {
	const block = renderPaletteCssBlock();
	const beginIdx = css.indexOf(BEGIN_SENTINEL);
	const endIdx = css.indexOf(END_SENTINEL);
	if (beginIdx !== -1 && endIdx !== -1) {
		const lineEnd = css.indexOf('\n', endIdx);
		const tail = lineEnd === -1 ? '' : css.slice(lineEnd);
		return css.slice(0, beginIdx) + block + tail;
	}
	throw new Error(
		'gen-palette-css: sentinels not found in app.css. Add the BEGIN/END markers around the --color-type-* block.'
	);
}

function main(): void {
	const check = process.argv.includes('--check');
	const css = readFileSync(APP_CSS_PATH, 'utf8');
	const next = applyBlock(css);
	if (check) {
		if (next !== css) {
			console.error(
				'✗ src/app.css --color-type-* block is out of date. Run: npm run gen:palette-css'
			);
			process.exit(1);
		}
		console.log('✓ src/app.css --color-type-* block matches ENTITY_TYPE_HEX');
		return;
	}
	if (next !== css) {
		writeFileSync(APP_CSS_PATH, next);
		console.log('✓ wrote --color-type-* block to src/app.css');
	} else {
		console.log('✓ src/app.css already up to date');
	}
}

// Run only when invoked as a CLI (not when imported by the drift test).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main();
}
