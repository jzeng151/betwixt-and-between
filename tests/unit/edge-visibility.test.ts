import { describe, it, expect } from 'vitest';
import { isEdgeVisibleAtT } from '../../src/lib/stores/playhead.js';

describe('isEdgeVisibleAtT', () => {
	// Scrubber idle
	it('returns true when t is null (scrubber idle)', () => {
		expect(isEdgeVisibleAtT({ startPosition: 1.0, endPosition: 3.0 }, null)).toBe(true);
	});

	// Timeless edges
	it('returns true for timeless edge (both null) at any t', () => {
		expect(isEdgeVisibleAtT({ startPosition: null, endPosition: null }, 5.0)).toBe(true);
	});
	it('returns true for timeless edge (both undefined) at any t', () => {
		expect(isEdgeVisibleAtT({}, 5.0)).toBe(true);
	});

	// In-window
	it('returns true when t is within [start, end)', () => {
		expect(isEdgeVisibleAtT({ startPosition: 1.0, endPosition: 3.0 }, 2.5)).toBe(true);
	});
	it('returns true when t equals startPosition (inclusive)', () => {
		expect(isEdgeVisibleAtT({ startPosition: 1.0, endPosition: 3.0 }, 1.0)).toBe(true);
	});

	// Out-of-window
	it('returns false when t < startPosition', () => {
		expect(isEdgeVisibleAtT({ startPosition: 1.0, endPosition: 3.0 }, 0.5)).toBe(false);
	});
	it('returns false when t equals endPosition (exclusive)', () => {
		expect(isEdgeVisibleAtT({ startPosition: 1.0, endPosition: 3.0 }, 3.0)).toBe(false);
	});
	it('returns false when t > endPosition', () => {
		expect(isEdgeVisibleAtT({ startPosition: 1.0, endPosition: 3.0 }, 3.5)).toBe(false);
	});

	// One-sided bounds
	it('returns true when no lower bound and t < endPosition', () => {
		expect(isEdgeVisibleAtT({ startPosition: null, endPosition: 3.0 }, 2.5)).toBe(true);
	});
	it('returns false when no lower bound and t >= endPosition', () => {
		expect(isEdgeVisibleAtT({ startPosition: null, endPosition: 3.0 }, 5.0)).toBe(false);
	});
	it('returns true when no upper bound and t >= startPosition', () => {
		expect(isEdgeVisibleAtT({ startPosition: 1.0, endPosition: null }, 2.5)).toBe(true);
	});
	it('returns false when no upper bound and t < startPosition', () => {
		expect(isEdgeVisibleAtT({ startPosition: 1.0, endPosition: null }, 0.5)).toBe(false);
	});
});
