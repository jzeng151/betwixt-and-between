// Cinematic Spotlight (Slice 8) PR0 — pure tint-ease contract. The on-canvas
// glide is Pixi-only (not unit-assertable); this pins the colour math the
// anim-controller tick drives imperatively.

import { describe, it, expect } from 'vitest';
import { hexToRgb, rgbToTint, easeRgb, type Rgb } from '../../src/lib/features/map/color-ease.js';

describe('hexToRgb', () => {
	it('parses #rrggbb', () => {
		expect(hexToRgb('#ff8800')).toEqual([0xff, 0x88, 0x00]);
	});

	it('expands #rgb short form', () => {
		expect(hexToRgb('#f80')).toEqual([0xff, 0x88, 0x00]);
	});

	it('drops the alpha byte from #rrggbbaa', () => {
		expect(hexToRgb('#ff880080')).toEqual([0xff, 0x88, 0x00]);
	});

	it('tolerates a missing leading #', () => {
		expect(hexToRgb('ff8800')).toEqual([0xff, 0x88, 0x00]);
	});

	it('falls back to neutral gray on malformed input (no NaN)', () => {
		expect(hexToRgb('not-a-color')).toEqual([0x9c, 0xa3, 0xaf]);
		expect(hexToRgb('#12')).toEqual([0x9c, 0xa3, 0xaf]);
	});

	it('never returns NaN channels for partially-parseable junk (user color data)', () => {
		// A wrong-length string with non-hex chars expands then fails the length
		// gate or NaN-parses → neutral. Whatever the path, channels are finite.
		for (const bad of ['#xyz', '12 456', '#ggg', '######']) {
			const rgb = hexToRgb(bad);
			expect(rgb.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)).toBe(true);
		}
	});
});

describe('rgbToTint', () => {
	it('packs channels into 0xRRGGBB', () => {
		expect(rgbToTint([0xff, 0x88, 0x00])).toBe(0xff8800);
	});

	it('round-trips with hexToRgb', () => {
		expect(rgbToTint(hexToRgb('#3b82f6'))).toBe(0x3b82f6);
	});

	it('clamps and rounds out-of-range / fractional channels (mid-ease values)', () => {
		expect(rgbToTint([300, -5, 127.6])).toBe((255 << 16) | (0 << 8) | 128);
	});
});

describe('easeRgb', () => {
	it('moves every channel toward the target without overshooting', () => {
		const from: Rgb = [0, 0, 0];
		const to: Rgb = [255, 128, 64];
		const next = easeRgb(from, to, 16, 150);
		for (let i = 0; i < 3; i++) {
			expect(next[i]).toBeGreaterThan(from[i]);
			expect(next[i]).toBeLessThan(to[i]);
		}
	});

	it('is frame-rate independent per channel: two half-steps ≈ one full step', () => {
		const to: Rgb = [255, 255, 255];
		const one = easeRgb([0, 0, 0], to, 16, 150);
		const halfA = easeRgb([0, 0, 0], to, 8, 150);
		const halfB = easeRgb(halfA, to, 8, 150);
		expect(Math.abs(halfB[0] - one[0])).toBeLessThan(1e-9);
	});

	it('settles onto the exact target packed tint after many frames', () => {
		let cur: Rgb = [0x9c, 0xa3, 0xaf];
		const target = hexToRgb('#3b82f6');
		for (let i = 0; i < 200; i++) cur = easeRgb(cur, target, 16, 150);
		expect(rgbToTint(cur)).toBe(0x3b82f6);
	});
});
