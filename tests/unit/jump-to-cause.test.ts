import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { playhead } from '../../src/lib/features/timeline/playhead-store.js';
import {
	jumpToCause,
	isCausalEdgeClickable
} from '../../src/lib/features/timeline/jump-to-cause.js';

/**
 * WM3 Slice 5 D5 — EventChain click-to-jump semantics (shared by both graph
 * surfaces and, in PR-C, the map). Clicking a caused_by edge scrubs the
 * playhead to the link's startPosition; everything else is a no-op.
 */
describe('jumpToCause', () => {
	beforeEach(() => {
		playhead.dismiss(); // idle → get(playhead) === null
	});

	it('caused_by with a startPosition scrubs the playhead and returns true', () => {
		const jumped = jumpToCause({ type: 'caused_by', startPosition: 1.5 });
		expect(jumped).toBe(true);
		expect(get(playhead)).toBe(1.5);
	});

	it('caused_by at startPosition 0 still jumps (0 is a valid position, not falsy-skip)', () => {
		const jumped = jumpToCause({ type: 'caused_by', startPosition: 0 });
		expect(jumped).toBe(true);
		expect(get(playhead)).toBe(0);
	});

	it('non-caused_by edge is a no-op', () => {
		const jumped = jumpToCause({ type: 'allied_with', startPosition: 1.5 });
		expect(jumped).toBe(false);
		expect(get(playhead)).toBe(null);
	});

	it('timeless caused_by (null startPosition) is a no-op', () => {
		const jumped = jumpToCause({ type: 'caused_by', startPosition: null });
		expect(jumped).toBe(false);
		expect(get(playhead)).toBe(null);
	});

	it('undefined / null relationship is a safe no-op', () => {
		expect(jumpToCause(undefined)).toBe(false);
		expect(jumpToCause(null)).toBe(false);
		expect(get(playhead)).toBe(null);
	});
});

/**
 * The click affordance gate, shared by StoryGraph + FocusedGraph. Mirrors
 * jumpToCause's scoped-caused_by preconditions and adds the mystery spoiler
 * guard: a pre-reveal edge must never be clickable, or the jump would leak the
 * hidden link's story-time. (Cross-model adversarial finding, Slice 5 ship.)
 */
describe('isCausalEdgeClickable', () => {
	it('scoped caused_by, not mystery → clickable', () => {
		expect(isCausalEdgeClickable({ type: 'caused_by', startPosition: 1.5 }, false)).toBe(true);
	});

	it('scoped caused_by at startPosition 0, not mystery → clickable', () => {
		expect(isCausalEdgeClickable({ type: 'caused_by', startPosition: 0 }, false)).toBe(true);
	});

	it('mystery edge is NOT clickable even when scoped (spoiler guard)', () => {
		expect(isCausalEdgeClickable({ type: 'caused_by', startPosition: 1.5 }, true)).toBe(false);
	});

	it('timeless caused_by (null startPosition) is not clickable', () => {
		expect(isCausalEdgeClickable({ type: 'caused_by', startPosition: null }, false)).toBe(false);
	});

	it('non-caused_by edge is not clickable', () => {
		expect(isCausalEdgeClickable({ type: 'allied_with', startPosition: 1.5 }, false)).toBe(false);
	});
});
