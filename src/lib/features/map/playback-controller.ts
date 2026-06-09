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

import { diffPunctuation, ripplesFrom, type Punctuation } from './punctuation-diff.js';
import type { RenderedState } from './projection.js';

export type PlaybackReaction = {
	/**
	 * Process one rendered frame. Returns the punctuation beats to spawn (empty
	 * when idle, on the first frame, or when nothing changed). Updates the diff
	 * baseline and resets it on a map switch — call this whenever renderedState,
	 * playhead, or activeMapId changes.
	 *
	 * `projectAt` (ADR 0007 Fix B): project the CURRENT map (the one
	 * renderedState came from) at an arbitrary playhead. On the first frame after
	 * a map switch the controller calls it with the PRIOR playhead to seed the
	 * causal-ripple baseline — an edge already lit before the boundary is in the
	 * baseline (silent, the #505 class), an edge that lit AT the boundary is not
	 * (it ripples — the cycle-onto-causal-resolution beat that a null baseline
	 * swallowed). Conquest/march keep the null-on-switch baseline (their phantom
	 * guard is unchanged). Optional: without it, switch frames stay fully silent.
	 */
	frame(
		renderedState: RenderedState | null,
		playhead: number | null,
		activeMapId: string | null,
		projectAt?: (t: number) => RenderedState | null
	): Punctuation[];
	/**
	 * Tell the controller the upcoming map switch is an auto-cycle COMMIT and
	 * what the pre-boundary playhead was (ADR 0007 Fix B). Without this, the
	 * switch frame falls back to `lastPlayhead` as the ripple-baseline T — but
	 * the FX frame runs BEFORE the cycling driver in the same flush, so by the
	 * time the cycle commits, lastPlayhead has already advanced PAST the act
	 * boundary (and a prefetch-delayed commit lands whole ticks later). The
	 * driver knows the last playhead at which the view was still settled on the
	 * old map; passing it here makes the baseline genuinely pre-boundary. Call
	 * right before flipping activeMapId; consumed by the next switch frame.
	 * Manual switches don't call it and keep the lastPlayhead fallback (silent
	 * when paused: prior T == current T).
	 */
	noteCycleCommit(priorT: number | null): void;
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
	// ADR 0007 Fix B: the playhead the view left the PREVIOUS map at, pending
	// consumption by the first projected frame on the new map. Non-null only in
	// the switch→first-frame window.
	let switchPriorT: number | null = null;
	// Pre-boundary playhead announced by the cycling driver via noteCycleCommit,
	// pending the switch frame it belongs to.
	let notedCyclePriorT: number | null = null;

	return {
		frame(renderedState, playhead, activeMapId, projectAt) {
			// Reset the baseline on a map switch so the first frame on the new map
			// can't diff against the old map's regions and emit phantom flashes.
			if (activeMapId !== mapId) {
				mapId = activeMapId;
				lastPlayed = null;
				// Remember where the playhead stood when the previous map was last
				// rendered: the ripple pass below projects the NEW map at this T to
				// learn which causal edges were already lit before the boundary. An
				// auto-cycle commit announces the true pre-boundary T (the FX frame
				// has already advanced lastPlayhead past the boundary by commit
				// time); a manual switch falls back to lastPlayhead.
				switchPriorT = notedCyclePriorT ?? lastPlayhead;
				notedCyclePriorT = null;
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
			// A rewind also voids the pending switch baseline — replay re-seeds
			// silently, same as the conquest contract.
			if (lastPlayhead !== null && playhead < lastPlayhead) {
				lastPlayed = null;
				switchPriorT = null;
			}
			lastPlayhead = playhead;

			let beats = diffPunctuation(lastPlayed, renderedState, playhead);
			// ADR 0007 Fix B — ripples across the map boundary. On the first
			// projected frame after a switch, diff cur's lit edges against the new
			// map projected at the PRIOR playhead: only edges that genuinely lit in
			// (priorT, playhead] ripple. An edge lit before the boundary — or a
			// cycle-back onto a still-lit edge — is in the prior projection and
			// stays silent (#505 stays dead). Manual switch while paused projects
			// at the same T as cur → identical edge set → silent, preserving the
			// "manual switch fires nothing" behavior Fix A broke.
			if (lastPlayed === null && switchPriorT !== null) {
				if (projectAt) {
					const prior = projectAt(switchPriorT);
					if (prior) {
						const litBefore = new Set<string>();
						for (const e of prior.causalEdges) litBefore.add(e.relationshipId);
						beats = beats.concat(ripplesFrom(litBefore, renderedState));
					}
				}
				switchPriorT = null; // one-shot: later frames diff normally
			}
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
		noteCycleCommit(priorT) {
			notedCyclePriorT = priorT;
		},
		reset() {
			lastPlayed = null;
			lastPlayhead = null;
			switchPriorT = null;
			notedCyclePriorT = null;
		}
	};
}
