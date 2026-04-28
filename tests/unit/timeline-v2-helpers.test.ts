import { describe, it, expect } from 'vitest';
import {
	widthClassForBar,
	presenceLabel,
	internalActBoundaryFractions
} from '../../src/lib/timeline-v2-helpers.js';

describe('widthClassForBar', () => {
	it('returns "tiny" for widths below 40px', () => {
		expect(widthClassForBar(0)).toBe('tiny');
		expect(widthClassForBar(20)).toBe('tiny');
		expect(widthClassForBar(39.999)).toBe('tiny');
	});
	it('returns "narrow" for widths in [40, 100)', () => {
		expect(widthClassForBar(40)).toBe('narrow');
		expect(widthClassForBar(60)).toBe('narrow');
		expect(widthClassForBar(99.999)).toBe('narrow');
	});
	it('returns "normal" for widths >= 100px', () => {
		expect(widthClassForBar(100)).toBe('normal');
		expect(widthClassForBar(150)).toBe('normal');
		expect(widthClassForBar(800)).toBe('normal');
	});
	it('handles edge cases (negative, NaN-like)', () => {
		// negative width: treat as tiny (defensive)
		expect(widthClassForBar(-10)).toBe('tiny');
	});
});

describe('presenceLabel', () => {
	// Single-act, no scene context
	it('full Act 1 → "Act 1"', () => {
		expect(presenceLabel(1.0, 2.0)).toBe('Act 1');
	});

	it('first 25% of Act 1 → "first 25% of Act 1"', () => {
		expect(presenceLabel(1.0, 1.25)).toBe('first 25% of Act 1');
	});

	it('last 50% of Act 1 → "last 50% of Act 1"', () => {
		expect(presenceLabel(1.5, 2.0)).toBe('last 50% of Act 1');
	});

	it('mid-fraction of Act 0 → "25–75% of Act 0"', () => {
		expect(presenceLabel(0.25, 0.75)).toBe('25–75% of Act 0');
	});

	// Scene-anchored single-act
	it('full Act 1 with scenes context still says "Act 1"', () => {
		expect(presenceLabel(1.0, 2.0, { sceneCounts: { 1: 5 } })).toBe('Act 1');
	});

	it('one scene of Act 1 (scene 0 of 5) → "Act 1, scene 0"', () => {
		expect(presenceLabel(1.0, 1.2, { sceneCounts: { 1: 5 } })).toBe('Act 1, scene 0');
	});

	it('scenes 1–3 of Act 1 (5 scenes) → "Act 1, scenes 1–3 of 5"', () => {
		expect(presenceLabel(1.2, 1.8, { sceneCounts: { 1: 5 } })).toBe('Act 1, scenes 1–3 of 5');
	});

	// Multi-act
	it('Act 0 → end of Act 2 → "start of Act 0 → end of Act 2"', () => {
		expect(presenceLabel(0, 3)).toBe('start of Act 0 → end of Act 2');
	});

	it('middle of Act 0 through end of Act 2 → "50% into Act 0 → end of Act 2"', () => {
		expect(presenceLabel(0.5, 3.0)).toBe('50% into Act 0 → end of Act 2');
	});

	it('mid Act 1 → mid Act 2 → "50% into Act 1 → 75% into Act 2"', () => {
		expect(presenceLabel(1.5, 2.75)).toBe('50% into Act 1 → 75% into Act 2');
	});
});

describe('internalActBoundaryFractions', () => {
	it('single-act bar has no internal boundaries', () => {
		expect(internalActBoundaryFractions(1.0, 2.0)).toEqual([]);
		expect(internalActBoundaryFractions(1.2, 1.8)).toEqual([]);
		expect(internalActBoundaryFractions(0.25, 0.75)).toEqual([]);
	});

	it('two-act span produces one boundary at the right fraction', () => {
		// span [0.5, 2.0): boundary at 1.0 → fraction = (1.0 - 0.5) / 1.5 = 0.333...
		const fractions = internalActBoundaryFractions(0.5, 2.0);
		expect(fractions).toHaveLength(1);
		expect(fractions[0]).toBeCloseTo(1 / 3, 9);
	});

	it('three-act span produces two boundaries', () => {
		// span [0.0, 3.0): boundaries at 1.0 and 2.0
		const fractions = internalActBoundaryFractions(0.0, 3.0);
		expect(fractions).toHaveLength(2);
		expect(fractions[0]).toBeCloseTo(1 / 3, 9);
		expect(fractions[1]).toBeCloseTo(2 / 3, 9);
	});

	it('off-boundary span: 0.5 → 2.5 produces one boundary at 1.0 and one at 2.0', () => {
		const fractions = internalActBoundaryFractions(0.5, 2.5);
		expect(fractions).toHaveLength(2);
		expect(fractions[0]).toBeCloseTo(0.25, 9); // (1.0 - 0.5) / 2.0
		expect(fractions[1]).toBeCloseTo(0.75, 9); // (2.0 - 0.5) / 2.0
	});

	it('end exactly on whole-act boundary is NOT itself a boundary marker', () => {
		// span [1.0, 2.0): endActIdx = floor(2.0 - epsilon) = 1, so no internal boundaries.
		expect(internalActBoundaryFractions(1.0, 2.0)).toEqual([]);
	});
});
