import { writable, get } from 'svelte/store';

/**
 * Global playhead — a value on the story-time axis (the same `position`
 * axis used by intervals: integer act indices, fractions within acts).
 *
 *   null       = idle (no scrubbing). Subscribers should treat as "show
 *                everything"; the playhead overlay does not render.
 *   number ≥ 0 = active. Subscribers filter to entities whose interval
 *                contains the value (half-open: start ≤ T < end).
 *
 * The Timeline app owns activation via the titlebar toggle. Other apps
 * (Story Graph, World Map) subscribe read-only and react.
 */

function createPlayheadStore() {
	const { subscribe, set } = writable<number | null>(null);

	/** Activate the playhead at the given story-time position. */
	function scrubTo(t: number) {
		if (Number.isNaN(t) || !Number.isFinite(t) || t < 0) return;
		set(t);
	}

	/** Toggle activation. If currently null, activate at `defaultT` (or 0). */
	function toggle(defaultT = 0) {
		const cur = get({ subscribe });
		set(cur == null ? Math.max(0, defaultT) : null);
	}

	/** Idle the playhead. Subscribers go back to "show everything." */
	function dismiss() {
		set(null);
	}

	return { subscribe, scrubTo, toggle, dismiss };
}

export const playhead = createPlayheadStore();

/**
 * Pure helper: does an interval [start, end) contain the position T?
 * Half-open per CONSIDERATIONS.md.
 */
export function intervalContainsT(start: number, end: number, t: number): boolean {
	return start <= t && t < end;
}
