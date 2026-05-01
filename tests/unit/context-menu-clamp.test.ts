import { describe, it, expect } from 'vitest';
import { clampToViewport } from '../../src/lib/components/context-menu-clamp.js';

describe('clampToViewport', () => {
	it('returns the input position when the menu fits', () => {
		const r = clampToViewport(100, 100, 150, 200, 1000, 800);
		expect(r).toEqual({ x: 100, y: 100 });
	});

	it('shifts left when the menu would overflow the right edge', () => {
		const r = clampToViewport(900, 100, 150, 200, 1000, 800);
		// 900 + 150 = 1050 > 1000 → shift to 1000 - 150 = 850
		expect(r).toEqual({ x: 850, y: 100 });
	});

	it('shifts up when the menu would overflow the bottom edge', () => {
		const r = clampToViewport(100, 700, 150, 200, 1000, 800);
		// 700 + 200 = 900 > 800 → shift to 800 - 200 = 600
		expect(r).toEqual({ x: 100, y: 600 });
	});

	it('shifts both axes when needed', () => {
		const r = clampToViewport(950, 750, 150, 200, 1000, 800);
		expect(r).toEqual({ x: 850, y: 600 });
	});

	it('clamps to 0 when the menu is wider than the viewport', () => {
		const r = clampToViewport(100, 100, 1200, 200, 1000, 800);
		expect(r.x).toBe(0);
	});

	it('clamps to 0 when the menu is taller than the viewport', () => {
		const r = clampToViewport(100, 100, 150, 900, 1000, 800);
		expect(r.y).toBe(0);
	});
});
