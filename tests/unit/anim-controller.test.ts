import { describe, it, expect } from 'vitest';
import {
	advanceAnimClock,
	createAnimController,
	ANIM_CLOCK_WRAP_SECONDS
} from '../../src/lib/features/map/anim-controller.js';

describe('advanceAnimClock', () => {
	it('advances by deltaMs / 1000 seconds', () => {
		expect(advanceAnimClock(0, 1000)).toBeCloseTo(1);
		expect(advanceAnimClock(2, 500)).toBeCloseTo(2.5);
	});

	it('treats NaN / negative / zero delta as no step (no poisoning)', () => {
		expect(advanceAnimClock(5, NaN)).toBe(5);
		expect(advanceAnimClock(5, -16)).toBe(5);
		expect(advanceAnimClock(5, 0)).toBe(5);
	});

	it('wraps to stay f32-safe over long sessions', () => {
		const justUnder = ANIM_CLOCK_WRAP_SECONDS - 0.5;
		// step of 1s crosses the wrap boundary → result lands near 0.5
		const wrapped = advanceAnimClock(justUnder, 1000);
		expect(wrapped).toBeGreaterThanOrEqual(0);
		expect(wrapped).toBeLessThan(ANIM_CLOCK_WRAP_SECONDS);
		expect(wrapped).toBeCloseTo(0.5);
	});

	it('respects a custom wrap', () => {
		expect(advanceAnimClock(9.5, 1000, 10)).toBeCloseTo(0.5);
	});
});

describe('createAnimController', () => {
	// Minimal fake of the bits of a Pixi Application the controller touches.
	function fakeApp() {
		let cb: ((ticker: { deltaMS: number }) => void) | null = null;
		return {
			added: () => cb !== null,
			frame(deltaMS: number) {
				cb?.({ deltaMS });
			},
			app: {
				ticker: {
					add(fn: (t: { deltaMS: number }) => void) {
						cb = fn;
					},
					remove(fn: unknown) {
						if (cb === fn) cb = null;
					}
				}
			}
		};
	}

	it('advances the shared clock and notifies subscribers each frame', () => {
		const f = fakeApp();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const anim = createAnimController(f.app as any);
		const seen: number[] = [];
		anim.register((t) => seen.push(t));

		f.frame(1000);
		f.frame(500);

		expect(anim.clock.time).toBeCloseTo(1.5);
		expect(seen).toHaveLength(2);
		expect(seen[0]).toBeCloseTo(1);
		expect(seen[1]).toBeCloseTo(1.5);
	});

	it('unsubscribe stops further notifications but clock keeps ticking', () => {
		const f = fakeApp();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const anim = createAnimController(f.app as any);
		const seen: number[] = [];
		const off = anim.register((t) => seen.push(t));

		f.frame(1000);
		off();
		f.frame(1000);

		expect(seen).toHaveLength(1);
		expect(anim.clock.time).toBeCloseTo(2);
	});

	it('destroy removes the ticker callback and is idempotent', () => {
		const f = fakeApp();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const anim = createAnimController(f.app as any);
		expect(f.added()).toBe(true);
		anim.destroy();
		expect(f.added()).toBe(false);
		expect(() => anim.destroy()).not.toThrow();
	});
});
