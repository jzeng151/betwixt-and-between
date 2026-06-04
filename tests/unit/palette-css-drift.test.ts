// Settings customization Phase 2, Item 1 / CQ1 — drift guard (IRON-RULE
// regression #2). The committed `--color-type-*` block in src/app.css must
// equal the output generated from ENTITY_TYPE_HEX, so the canvas palette
// (style-cascade hex) and the DOM palette (var(--color-type-*)) can never
// silently diverge. If this fails, run: npm run gen:palette-css.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { renderPaletteCssBlock } from '../../scripts/gen-palette-css.js';
import { ENTITY_TYPE_HEX } from '../../src/lib/entity-type-colors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_CSS = resolve(__dirname, '../../src/app.css');

describe('palette CSS drift guard', () => {
	it('committed src/app.css --color-type-* block equals the generated block', () => {
		const css = readFileSync(APP_CSS, 'utf8');
		expect(css).toContain(renderPaletteCssBlock());
	});

	it('every EntityType hex appears as its --color-type-* var', () => {
		const css = readFileSync(APP_CSS, 'utf8');
		for (const [type, hex] of Object.entries(ENTITY_TYPE_HEX)) {
			expect(css).toMatch(new RegExp(`--color-type-${type.toLowerCase()}:\\s+${hex};`));
		}
	});
});
