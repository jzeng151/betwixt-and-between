// Cinematic Spotlight (Slice 8) — playback reaction controller (pure).
//
// Coordinates the map's reaction to the shipped autoplay (playhead.play()). It
// owns the small amount of FRAME-TO-FRAME state the reaction needs, kept out of
// the 2400-line WorldMap.svelte:
//
//   - the `lastPlayedRenderedState` baseline the punctuation diff compares
//     against, reset on activeMapId change (phantom-FX-across-maps guard) and
//     preserved across idle so the first transition after idle isn't swallowed
//     (eng-review decision #6);
//   - the pin-on-interact flag: any manual map-select / pan / zoom pins the view
//     and SUSPENDS camera-follow (and, in PR2, between-map cycling) until
//     playback restarts. FX punctuation is NOT pinned — a flash still fires on a
//     manual scrub (test plan: "manual scrub → punctuation FX still fire").
//
// Pure (no window/Pixi/store imports) so the reaction logic is unit-tested
// without a browser. WorldMap drives it with reactive values and renders the
// returned beats / reads `pinned`.

import { diffPunctuation, type Punctuation } from './punctuation-diff.js';
import type { RenderedState } from './projection.js';

export type PlaybackReaction = {
	/**
	 * Process one rendered frame. Returns the punctuation beats to spawn (empty
	 * when idle, on the first frame, or when nothing changed). Updates the diff
	 * baseline and resets it on a map switch — call this whenever renderedState,
	 * playhead, or activeMapId changes.
	 */
	frame(
		renderedState: RenderedState | null,
		playhead: number | null,
		activeMapId: string | null
	): Punctuation[];
	/** True while the user has pinned the view; camera-follow is suspended. */
	readonly pinned: boolean;
	/** Pin on manual map-select / pan / zoom. */
	pin(): void;
	/** Unpin when playback (re)starts. */
	unpin(): void;
	/** Drop the diff baseline (replay-from-start / teardown) so the next frame
	 *  doesn't diff against a stale state. */
	reset(): void;
};

export function createPlaybackReaction(): PlaybackReaction {
	let lastPlayed: RenderedState | null = null;
	let lastPlayhead: number | null = null;
	let mapId: string | null = null;
	let pinned = false;

	return {
		frame(renderedState, playhead, activeMapId) {
			// Reset the baseline on a map switch so the first frame on the new map
			// can't diff against the old map's regions and emit phantom flashes.
			if (activeMapId !== mapId) {
				mapId = activeMapId;
				lastPlayed = null;
			}
			// Idle (or no state): hold the baseline, emit nothing. Preserving
			// lastPlayed across idle is what lets the first transition AFTER idle
			// register instead of being swallowed.
			if (renderedState === null || playhead === null) return [];

			// Backward playhead jump = replay-from-end (Play at maxT rewinds to 0)
			// or a reverse scrub. Diffing the rewound frame against the FORWARD
			// baseline would read the un-conquest as a conquest and spawn phantom
			// "reverse" flashes (and aim the camera at them). Drop the baseline so
			// this frame just re-seeds it and emits nothing; forward motion from
			// here diffs normally. (Conquest is a forward owner-flip by definition.)
			if (lastPlayhead !== null && playhead < lastPlayhead) lastPlayed = null;
			lastPlayhead = playhead;

			const beats = diffPunctuation(lastPlayed, renderedState, playhead);
			lastPlayed = renderedState;
			return beats;
		},
		get pinned() {
			return pinned;
		},
		pin() {
			pinned = true;
		},
		unpin() {
			pinned = false;
		},
		reset() {
			lastPlayed = null;
			lastPlayhead = null;
		}
	};
}
