import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { playhead, intervalContainsT } from '../../src/lib/stores/playhead.js';

beforeEach(async () => {
	playhead.dismiss();
});

describe('playhead store', () => {
	it('starts idle (null)', () => {
		expect(get(playhead)).toBeNull();
	});

	it('scrubTo activates at the given position', () => {
		playhead.scrubTo(1.5);
		expect(get(playhead)).toBe(1.5);
	});

	it('scrubTo rejects negative / NaN / Infinity', () => {
		playhead.scrubTo(2);
		playhead.scrubTo(-1);
		expect(get(playhead)).toBe(2);
		playhead.scrubTo(NaN);
		expect(get(playhead)).toBe(2);
		playhead.scrubTo(Infinity);
		expect(get(playhead)).toBe(2);
	});

	it('toggle from idle activates at defaultT', () => {
		playhead.toggle(1);
		expect(get(playhead)).toBe(1);
	});

	it('toggle from active idles', () => {
		playhead.scrubTo(1.2);
		playhead.toggle();
		expect(get(playhead)).toBeNull();
	});

	it('toggle clamps negative defaultT to 0', () => {
		playhead.toggle(-5);
		expect(get(playhead)).toBe(0);
	});

	it('dismiss returns to idle from any active state', () => {
		playhead.scrubTo(2.7);
		playhead.dismiss();
		expect(get(playhead)).toBeNull();
	});
});

describe('intervalContainsT', () => {
	it('half-open: start inclusive, end exclusive', () => {
		expect(intervalContainsT(1, 2, 1)).toBe(true);
		expect(intervalContainsT(1, 2, 1.5)).toBe(true);
		expect(intervalContainsT(1, 2, 2)).toBe(false);
	});
	it('rejects positions outside the interval', () => {
		expect(intervalContainsT(1, 2, 0.99)).toBe(false);
		expect(intervalContainsT(1, 2, 2.01)).toBe(false);
	});
});
