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

const _isPlaying = writable(false);
/** Whether the playhead is currently auto-advancing. Read-only to consumers. */
export const isPlaying = { subscribe: _isPlaying.subscribe };

/** Positions per second during auto-play. Writable so Timeline's speed selector can set it. */
export const playbackSpeed = writable(0.5);

/** When true, out-of-scope nodes are removed from both graphs instead of dimmed. */
export const hideOutOfScope = writable(false);

function createPlayheadStore() {
	const { subscribe, set } = writable<number | null>(null);
	let _interval: ReturnType<typeof setInterval> | null = null;

	/** Activate the playhead at the given story-time position. */
	function scrubTo(t: number) {
		if (Number.isNaN(t) || !Number.isFinite(t) || t < 0) return;
		set(t);
	}

	/** Toggle activation. If currently null, activate at `defaultT` (or 0). Stops playback. */
	function toggle(defaultT = 0) {
		const cur = get({ subscribe });
		if (cur != null) { pause(); set(null); }
		else set(Math.max(0, defaultT));
	}

	/** Idle the playhead. Subscribers go back to "show everything." Stops playback. */
	function dismiss() {
		pause();
		set(null);
	}

	/** Start auto-advancing the playhead. Stops at maxT. Resets to 0 if already at the end. */
	function play(maxT: number) {
		if (maxT <= 0) return;
		const cur = get({ subscribe });
		if (cur == null || cur >= maxT) set(0);
		_isPlaying.set(true);
		if (_interval) clearInterval(_interval);
		_interval = setInterval(() => {
			const speed = get(playbackSpeed);
			const t = get({ subscribe });
			if (t == null) { pause(); return; }
			const next = t + speed * 0.1;
			if (next >= maxT) { set(maxT); pause(); return; }
			set(next);
		}, 100);
	}

	/** Stop auto-advancing without dismissing the playhead. */
	function pause() {
		_isPlaying.set(false);
		if (_interval) { clearInterval(_interval); _interval = null; }
	}

	/** Pause and jump forward by one act position. */
	function stepForward(maxT: number) {
		pause();
		const cur = get({ subscribe }) ?? 0;
		scrubTo(Math.min(Math.floor(cur) + 1, maxT));
	}

	/** Pause and jump back by one act position. */
	function stepBack() {
		pause();
		const cur = get({ subscribe }) ?? 0;
		scrubTo(Math.max(Math.ceil(cur) - 1, 0));
	}

	return { subscribe, scrubTo, toggle, dismiss, play, pause, stepForward, stepBack };
}

export const playhead = createPlayheadStore();

/**
 * Pure helper: does an interval [start, end) contain the position T?
 * Half-open per CONSIDERATIONS.md.
 */
export function intervalContainsT(start: number, end: number, t: number): boolean {
	return start <= t && t < end;
}

export interface TemporalEdge {
	startPosition?: number | null;
	endPosition?: number | null;
}

/**
 * Returns true if an edge with optional temporal bounds should be visible
 * at story-time T.
 *
 * Rules:
 *   - t === null (scrubber idle): always true
 *   - both bounds null/undefined (timeless edge): always true
 *   - otherwise: true iff startPosition <= t < endPosition
 *     NULL on one side = unbounded on that side (0 for start, Infinity for end)
 */
/**
 * Returns true if the relationship is in mystery mode at story-time T:
 * the edge exists but hasn't been revealed to the reader yet.
 * Uses Relationship directly (not TemporalEdge) because only relationships
 * carry revealedAtPosition.
 */
export function isMysteryEdgeAtT(
	edge: { revealedAtPosition?: number | null },
	t: number | null
): boolean {
	if (t === null) return false;
	return edge.revealedAtPosition != null && t < edge.revealedAtPosition;
}

export function isEdgeVisibleAtT(edge: TemporalEdge, t: number | null): boolean {
	if (t === null) return true;
	if (edge.startPosition == null && edge.endPosition == null) return true;
	return intervalContainsT(
		edge.startPosition ?? 0,
		edge.endPosition ?? Infinity,
		t
	);
}
