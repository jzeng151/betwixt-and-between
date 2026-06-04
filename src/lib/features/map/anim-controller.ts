// World Map v3 Slice 6 (T1) — shared animation controller.
//
// ONE ticker, ONE clock, shared across every animated map layer (terrain
// tiles, decorations, entity-marker idle/hover). Per the Slice 6 eng review:
//
//   D6   — a single controller; layers subscribe instead of each spinning up
//          its own app.ticker loop (PixiPlacementLayer:578 today is its own
//          loop and folds into this controller in a later step).
//   Fix-4 — the clock is a PLAIN MUTABLE, never a Svelte `$state` rune. Shader
//          uniforms are written from the tick callback. If the clock were a
//          rune, every layer's geometry `$effect` would re-run at 60fps and
//          re-enter the rebuild storm PixiTerrainLayer:75 guards against.
//
// The controller is deliberately Pixi-agnostic at its core: `advanceAnimClock`
// is a pure function (unit-tested), and `createAnimController` is the thin
// wiring that drives it off a Pixi Application's ticker. Subscribers receive
// the current clock time (seconds) each frame and write it wherever they need
// (e.g. a filter uniform).

type PixiApplication = import('pixi.js').Application;

// Wrap the clock well before f32 precision degrades. Shaders consume `uTime`
// as a 32-bit float; past a few thousand seconds the mantissa loses the
// sub-frame resolution that smooth sine motion needs. Wrapping at a 2*PI
// multiple keeps sin(uTime * freq) continuous across the wrap for typical
// integer-ish frequencies, so motion does not visibly hitch when it rolls over.
export const ANIM_CLOCK_WRAP_SECONDS = 1000 * Math.PI * 2;

/**
 * Pure clock advance. Returns the next clock time in seconds, wrapped to
 * [0, ANIM_CLOCK_WRAP_SECONDS) to stay f32-safe over long sessions.
 *
 * Pure so it is unit-testable without a Pixi Application or a real ticker.
 */
export function advanceAnimClock(
	prevSeconds: number,
	deltaMs: number,
	wrapSeconds: number = ANIM_CLOCK_WRAP_SECONDS
): number {
	// Guard against the ticker handing us a NaN/negative delta on the first
	// frame or after a tab-restore stall — treat those as a zero step rather
	// than poisoning the clock.
	const step = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs / 1000 : 0;
	const next = prevSeconds + step;
	if (next < wrapSeconds) return next;
	// `% wrap` keeps phase continuity; prevSeconds is already < wrap.
	return next % wrapSeconds;
}

export type AnimSubscriber = (clockSeconds: number) => void;

export type AnimController = {
	/** Current clock time in seconds. Plain mutable (Fix-4) — read, don't bind. */
	readonly clock: { time: number };
	/** Register a per-frame callback. Returns an unsubscribe fn. */
	register(fn: AnimSubscriber): () => void;
	/** Remove the ticker callback and drop all subscribers. Idempotent. */
	destroy(): void;
};

/**
 * Wire a single ticker loop on the given Pixi Application. Each frame advances
 * the shared clock and notifies every subscriber with the new time.
 *
 *   const anim = createAnimController(app);
 *   const off = anim.register((t) => { shimmer.resources.u.uniforms.uTime = t; });
 *   ... onDestroy: off(); anim.destroy();
 */
export function createAnimController(app: PixiApplication): AnimController {
	const clock = { time: 0 };
	const subscribers = new Set<AnimSubscriber>();
	let destroyed = false;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const tick = (ticker: any): void => {
		// Pixi v8 passes the Ticker; deltaMS is wall-clock ms since last frame.
		const deltaMs = typeof ticker?.deltaMS === 'number' ? ticker.deltaMS : 0;
		clock.time = advanceAnimClock(clock.time, deltaMs);
		for (const fn of subscribers) fn(clock.time);
	};

	app.ticker.add(tick);

	return {
		clock,
		register(fn: AnimSubscriber): () => void {
			subscribers.add(fn);
			return () => subscribers.delete(fn);
		},
		destroy(): void {
			if (destroyed) return;
			destroyed = true;
			try {
				app.ticker.remove(tick);
			} catch (_) {
				/* app/ticker may already be torn down on unmount */
			}
			subscribers.clear();
		}
	};
}
