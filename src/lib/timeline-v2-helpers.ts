/**
 * Pure helpers for V2 timeline rendering. Extracted to a non-Svelte file
 * so they can be unit-tested without component-test infrastructure.
 *
 * See CONSIDERATIONS.md → "/plan-design-review resolutions item 3" for
 * the width-breakpoint contract.
 */

export type WidthClass = 'tiny' | 'narrow' | 'normal';

/**
 * Decide which text-rendering class a bar gets based on its rendered width.
 *
 *   width >= 100px → 'normal' (name + note)
 *   40px <= width < 100px → 'narrow' (name only)
 *   width < 40px → 'tiny' (no text; tooltip-only identification)
 *
 * Boundaries are exclusive at the upper end for `tiny`/`narrow` to keep the
 * thresholds unambiguous. A bar exactly 40px wide is `narrow`; exactly 100px
 * wide is `normal`.
 */
export function widthClassForBar(widthPx: number): WidthClass {
	if (widthPx < 40) return 'tiny';
	if (widthPx < 100) return 'narrow';
	return 'normal';
}

/**
 * Compute the human-readable presence range for an interval, given the
 * computed start and end positions on the global story-time axis.
 *
 * Positions follow the half-open convention [start, end) per
 * CONSIDERATIONS.md → "Convention: half-open intervals."
 *
 * Examples:
 *   (1.0, 2.0)         → "Act 1"                         (full-act presence)
 *   (1.0, 1.25)        → "first 25% of Act 1"
 *   (1.5, 2.0)         → "last 50% of Act 1"
 *   (0.5, 3.0)         → "middle of Act 0 → end of Act 2" (multi-act span)
 *   (1.2, 1.8)         → "Act 1, scenes 1–3 of 5"        (scene-anchored, ctx)
 *
 * Caller passes optional `actCount` and `sceneCounts` for richer phrasing
 * when scene context is available; falls back to fraction phrasing when not.
 */
export interface PresenceLabelContext {
	/** Number of root-level Acts in the story; used for "of N" phrasing if desired. */
	actCount?: number;
	/** Map from act_index → scene count; used for scene-anchored ranges. */
	sceneCounts?: Record<number, number>;
}

export function presenceLabel(
	startPosition: number,
	endPosition: number,
	ctx: PresenceLabelContext = {}
): string {
	const startActIdx = Math.floor(startPosition);
	const endActIdx = Math.floor(endPosition - 1e-12); // half-open: end-of-act sits at next int
	const startFrac = startPosition - startActIdx;
	const endFrac = endPosition - endActIdx;

	// Single-act presence
	if (startActIdx === endActIdx) {
		const m = ctx.sceneCounts?.[startActIdx] ?? 0;
		// Scene-anchored: detect when start/end align cleanly with scene boundaries
		if (m > 0) {
			const startSceneIdx = Math.round(startFrac * m);
			const endSceneIdx = Math.round(endFrac * m);
			const startMatches = Math.abs(startFrac * m - startSceneIdx) < 1e-9;
			const endMatches = Math.abs(endFrac * m - endSceneIdx) < 1e-9;
			if (startMatches && endMatches) {
				if (startSceneIdx === 0 && endSceneIdx === m) return `Act ${startActIdx}`;
				if (endSceneIdx - startSceneIdx === 1) {
					return `Act ${startActIdx}, scene ${startSceneIdx}`;
				}
				return `Act ${startActIdx}, scenes ${startSceneIdx}–${endSceneIdx - 1} of ${m}`;
			}
		}
		// Pure fraction
		if (startFrac === 0 && endFrac === 1) return `Act ${startActIdx}`;
		if (startFrac === 0) return `first ${Math.round(endFrac * 100)}% of Act ${startActIdx}`;
		if (endFrac === 1) return `last ${Math.round((1 - startFrac) * 100)}% of Act ${startActIdx}`;
		return `${Math.round(startFrac * 100)}–${Math.round(endFrac * 100)}% of Act ${startActIdx}`;
	}

	// Multi-act
	const startStr =
		startFrac === 0
			? `start of Act ${startActIdx}`
			: `${Math.round(startFrac * 100)}% into Act ${startActIdx}`;
	const endStr =
		endFrac === 1
			? `end of Act ${endActIdx}`
			: `${Math.round(endFrac * 100)}% into Act ${endActIdx}`;
	return `${startStr} → ${endStr}`;
}

/**
 * Compute the act-boundary fractions (within the bar, range (0, 1)) where
 * hairline markers should render for a multi-act interval.
 *
 *   span(start, end) covers acts floor(start) .. floor(end - epsilon).
 *   Act boundaries inside the span are at the integer act indexes between
 *   start and end. Their fractional position within the bar is
 *   (boundary - start) / (end - start).
 *
 * For a single-act bar, returns []. For a span covering N acts, returns N-1
 * fractions.
 */
export function internalActBoundaryFractions(
	startPosition: number,
	endPosition: number
): number[] {
	const startActIdx = Math.floor(startPosition);
	const endActIdx = Math.floor(endPosition - 1e-12);
	if (startActIdx === endActIdx) return [];
	const fractions: number[] = [];
	const span = endPosition - startPosition;
	for (let i = startActIdx + 1; i <= endActIdx; i++) {
		fractions.push((i - startPosition) / span);
	}
	return fractions;
}
