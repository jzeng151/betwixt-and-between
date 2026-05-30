// Slice 4 PR-E — easeToward: frame-rate-independent exponential smoothing used
// by the placement hover pulse/glow. The visual render is canvas-only (not
// unit-assertable); this pins the pure easing contract instead.

import { describe, it, expect } from 'vitest';
import { easeToward } from '../../src/lib/features/map/ease.js';

describe('easeToward', () => {
	it('moves toward the target without overshooting', () => {
		const next = easeToward(1, 1.15, 16, 55);
		expect(next).toBeGreaterThan(1);
		expect(next).toBeLessThan(1.15);
	});

	it('a larger frame delta advances further', () => {
		const small = easeToward(0, 1, 8, 55);
		const big = easeToward(0, 1, 32, 55);
		expect(big).toBeGreaterThan(small);
	});

	it('is frame-rate independent: two half-steps ≈ one full step', () => {
		const oneStep = easeToward(0, 1, 16, 55);
		const halfA = easeToward(0, 1, 8, 55);
		const halfB = easeToward(halfA, 1, 8, 55);
		expect(Math.abs(halfB - oneStep)).toBeLessThan(1e-9);
	});

	it('never overshoots even for huge deltas', () => {
		const next = easeToward(0, 1, 100000, 55);
		expect(next).toBeLessThanOrEqual(1);
		expect(next).toBeGreaterThan(0.99);
	});

	it('eases down toward zero (hover-out)', () => {
		const next = easeToward(1, 0, 16, 55);
		expect(next).toBeLessThan(1);
		expect(next).toBeGreaterThan(0);
	});

	it('settles to ~95% of the gap within ~3τ', () => {
		// One 165ms step (3 × 55ms τ) should cover ~95% of the distance.
		const next = easeToward(0, 1, 165, 55);
		expect(next).toBeGreaterThan(0.94);
	});

	it('non-positive tau snaps to target (degenerate guard)', () => {
		expect(easeToward(0, 1, 16, 0)).toBe(1);
	});
});
