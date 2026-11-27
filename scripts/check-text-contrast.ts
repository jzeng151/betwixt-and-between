// Run with node scripts/check-text-contrast.ts. Isolated CSS fixtures: no DB or preview port.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { parse } from 'svelte/compiler';
import { ENTITY_TYPE_COLOR_VAR } from '../src/lib/entity-type-colors.ts';
import { CHARACTER_COLORS } from '../src/lib/features/timeline/timeline-helpers.ts';
import { accentForeground } from '../src/lib/palette-cookie.ts';

const css = readFileSync('src/app.css', 'utf8');
const graph = 'lib/features/graph/';
// Mirror the relevant component ancestry; use production styles, not copies of color declarations.
const fixtures = [
	[graph + 'FocusedGraph', '<div class="fg-header"><span class="chip" data-check>Focal <button class="chip-x" data-check>×</button></span></div>'],
	[graph + 'GraphCanvas', `<div class="viewport">${['', 'node-active', 'node-out-of-scope'].map(state => `<div class="node ${state}"><span class="node-name" data-check>Name</span><span class="node-type" data-check>Type</span></div>`).join('')}</div>`],
	[graph + 'Legend', `<div class="legend">${['on', '', 'on absent', 'absent'].map(state => `<button class="legend-toggle ${state}"><span class="label" data-check>Allied with</span></button>`).join('')}</div>`],
	['lib/components/apps/Wiki', '<aside class="wiki-sidebar"><div class="type-divider"><span class="type-divider-label" data-check>Acts</span></div><button class="type-pill on" data-check>Locations</button><button class="type-pill" data-check>Acts</button></aside>'],
	['lib/os/Palette', '<aside class="palette"><section class="palette-section"><header class="palette-label"><span class="palette-label-text" data-check>Locations</span></header></section></aside>'],
	['lib/features/timeline/ActsHeader', '<div class="scenes-row"><div class="scenes-act"><div class="scenes-act-empty" data-check>· · · ·</div></div></div>'],
	['routes/auth/login/+page', '<div class="login-card"><p class="error" data-check>Sign-out unconfirmed. <a href="/app" data-check>Return to the workspace</a></p></div>']
];

const overrides = ['#000', '#fff', '#757575', '#767676', '#777777', '#00ff00', '#0000ff'];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
try {
	const page = await browser.newPage();
	for (const [component, markup] of fixtures) {
		const styles = parse(readFileSync(`src/${component}.svelte`, 'utf8')).css!.content.styles;
		await page.setContent(`<style>${css}\n${styles}</style>${markup}`);
		if (component.endsWith('FocusedGraph')) await page.locator('.chip-x').hover();
		const fills = component.endsWith('GraphCanvas') ? [...Object.values(ENTITY_TYPE_COLOR_VAR), ...CHARACTER_COLORS, ...overrides]
			: component.endsWith('FocusedGraph') ? ['', ...overrides] : [''];
		let minimum = Infinity;
		for (const theme of ['light', 'dark']) for (const fill of fills) {
			const results = await page.evaluate(({theme, fill, ink}) => {
				const root = document.documentElement;
				root.dataset.theme = theme;
				root.style.setProperty('--nc', fill);
				root.style.setProperty('--type-color', 'var(--color-type-location)');
				if (ink) {
					root.style.setProperty('--color-accent', fill);
					root.style.setProperty('--color-on-accent', ink);
				} else {
					root.style.removeProperty('--color-accent');
					root.style.removeProperty('--color-on-accent');
				}
				// Paint two pixels per layer (background / background + text). Canvas handles
				// computed color spaces, alpha fills, and group opacity on nested ancestors.
				function pixels() {
					const canvas = document.createElement('canvas');
					canvas.width = 2; canvas.height = 1;
					return canvas.getContext('2d', {willReadFrequently: true})!;
				}
				return [...document.querySelectorAll('[data-check]')].map(el => {
					let child: HTMLCanvasElement | undefined;
					let opacity = 1;
					for (let node: Element | null = el; node; node = node.parentElement) {
						const style = getComputedStyle(node), layer = pixels();
						layer.fillStyle = style.backgroundColor;
						layer.fillRect(0, 0, 2, 1);
						if (child) { layer.globalAlpha = opacity; layer.drawImage(child, 0, 0); }
						else { layer.fillStyle = style.color; layer.fillRect(1, 0, 1, 1); }
						child = layer.canvas; opacity = Number(style.opacity);
					}
					const rgb = child!.getContext('2d')!.getImageData(0, 0, 2, 1).data;
					const linear = (v: number) => v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4;
					const lum = (i: number) => .2126 * linear(rgb[i]) + .7152 * linear(rgb[i+1]) + .0722 * linear(rgb[i+2]);
					const a = lum(0), b = lum(4);
					return {label: el.textContent, ratio: (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
				});
			}, { theme, fill, ink: fill.startsWith('#') ? accentForeground(fill) : '' });
			assert(results.length > 0);
			for (const { label, ratio } of results) {
				assert(ratio >= 4.5, `${component}: ${label}, ${theme}, ${fill}: ${ratio}:1`);
				minimum = Math.min(minimum, ratio);
			}
		}
		console.log(`${component}: minimum ${minimum.toFixed(2)}:1`);
	}
} finally { await browser.close(); }
