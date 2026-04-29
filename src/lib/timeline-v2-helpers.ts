/**
 * Pure helpers for V2 timeline rendering. Extracted to a non-Svelte file
 * so they can be unit-tested without component-test infrastructure.
 *
 * See CONSIDERATIONS.md → "/plan-design-review resolutions item 3" for
 * the width-breakpoint contract.
 */

/**
 * Returns the position-axis range [start, end) for an Act with given index.
 *
 *   actIndex (i) → [i, i + 1)
 */
export function actRange(actIndex: number): { start: number; end: number } {
	return { start: actIndex, end: actIndex + 1 };
}

/**
 * Returns the position-axis range [start, end) for Scene k of m within Act i.
 *
 *   sceneIndex (k), sceneCount (m), actIndex (i) →
 *     [i + k/m, i + (k+1)/m)
 *
 * @param sceneIndex   k = 0-based index of the scene within its parent act
 * @param sceneCount   m = total number of scenes in the parent act (m > 0)
 * @param actIndex     i = 0-based index of the parent act on the global axis
 */
export function sceneRange(
	sceneIndex: number,
	sceneCount: number,
	actIndex: number
): { start: number; end: number } {
	if (sceneCount <= 0) {
		throw new Error(`sceneCount must be positive (got ${sceneCount})`);
	}
	if (sceneIndex < 0 || sceneIndex >= sceneCount) {
		throw new Error(
			`sceneIndex out of range: ${sceneIndex} not in [0, ${sceneCount})`
		);
	}
	return {
		start: actIndex + sceneIndex / sceneCount,
		end: actIndex + (sceneIndex + 1) / sceneCount
	};
}

/**
 * Smart-snap a raw cursor position to the nearest act/scene boundary.
 *
 *   1. actIndex = floor(position)
 *   2. m = scene count for that act
 *   3. if m > 0: snap to nearest scene boundary inside the act
 *      fractionInAct  = position - actIndex
 *      snappedFraction = round(fractionInAct * m) / m
 *      snappedPosition = actIndex + snappedFraction
 *   4. if m == 0: snap to nearest act boundary
 *      snappedPosition = round(position)
 *
 * Caller controls Alt-bypass by skipping this function entirely.
 *
 * @param position  raw cursor position on the global axis
 * @param sceneCountFor function returning m for a given act index. Implementations:
 *                     in tests: a Map. In production: looks up scenes via DB.
 */
export function smartSnap(
	position: number,
	sceneCountFor: (actIndex: number) => number
): number {
	const actIndex = Math.floor(position);
	const m = sceneCountFor(actIndex);
	if (m > 0) {
		const fractionInAct = position - actIndex;
		const snappedFraction = Math.round(fractionInAct * m) / m;
		return actIndex + snappedFraction;
	}
	return Math.round(position);
}

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

// ─── Color + label helpers (consumed by TimelineV2.svelte) ───────────────

/**
 * The 8-color cycle used to color character bars by row index when a
 * character has no custom color set in its data blob.
 */
export const CHARACTER_COLORS = [
	'#c8942a', // amber
	'#2dd4bf', // teal
	'#818cf8', // indigo
	'#86efac', // sage
	'#f472b6', // rose
	'#fbbf24', // gold
	'#34d399', // emerald
	'#60a5fa' // sky
] as const;

/** Solid grey for Event-type rows. */
export const EVENT_COLOR = '#94a3b8';

/** Hex color regex used by the color picker UI. */
export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Minimal entity shape consumed by these helpers (avoids store coupling). */
export interface EntityForHelpers {
	type: string;
	data: string;
}

export type TimelineLabelMode =
	| { mode: 'name-only' }
	| { mode: 'name-and-note' }
	| { mode: 'custom'; field: string };

/**
 * Parse the `entity.data` JSON string. Returns an empty object if the string
 * is missing or invalid — never throws. Returned values are otherwise raw.
 */
export function parseEntityData(raw: string | null | undefined): Record<string, unknown> {
	if (!raw) return {};
	try {
		const v = JSON.parse(raw);
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/**
 * Color for an entity bar.
 *   - Event rows always render in EVENT_COLOR.
 *   - Characters with a custom `data.color` (validated hex) use that color.
 *   - Otherwise, characters cycle through CHARACTER_COLORS by row index.
 */
export function colorFor(entity: EntityForHelpers, idx: number): string {
	if (entity.type === 'Event') return EVENT_COLOR;
	const d = parseEntityData(entity.data);
	const custom = typeof d.color === 'string' ? d.color : null;
	if (custom && HEX_COLOR_RE.test(custom)) return custom;
	return CHARACTER_COLORS[idx % CHARACTER_COLORS.length];
}

/**
 * Truncate to ~30 chars on whole-line basis: returns the first non-empty
 * line, with an ellipsis if it exceeds 30 chars. Returns null when the
 * source value is missing or contains no non-empty line.
 */
function firstLineSnippet(value: unknown): string | null {
	if (typeof value !== 'string' || !value) return null;
	const firstLine = value
		.split(/\r?\n/)
		.map((s) => s.trim())
		.filter(Boolean)[0];
	if (!firstLine) return null;
	return firstLine.length > 30 ? firstLine.slice(0, 30).trimEnd() + '…' : firstLine;
}

/**
 * Resolve the second-line label for an entity bar based on its
 * `data.timelineLabel` setting.
 *   - `name-only` → returns null (no second line)
 *   - `custom` with `field` → first line of `data[field]` (or null)
 *   - default / `name-and-note` / unset → first line of `data.notes`
 */
export function dataNoteSnippet(entity: EntityForHelpers): string | null {
	const d = parseEntityData(entity.data);
	const label = d.timelineLabel as TimelineLabelMode | undefined;
	if (label && typeof label === 'object' && 'mode' in label) {
		if (label.mode === 'name-only') return null;
		if (label.mode === 'custom') {
			const field = typeof label.field === 'string' ? label.field : '';
			if (!field) return null;
			return firstLineSnippet(d[field]);
		}
	}
	return firstLineSnippet(d.notes);
}

// ─── FK resolution (used by IntervalRow resize) ──────────────────────────────

export interface StartFKs {
	startActId: string;
	startSceneId: string | null;
	/**
	 * Position canonicalized to the act/scene boundary the FKs describe.
	 * Use this — not the raw cursor position — as the start_position to
	 * send in the PATCH. Resolves the float-near-boundary edge case where
	 * a position like 1.0000000002 would roll its FK into act0 but the
	 * raw position would fail the server's act-range check for act0.
	 */
	startPosition: number;
}

export interface EndFKs {
	endActId: string;
	endSceneId: string | null;
	endPosition: number;
}

/**
 * Map a position to FK references for writeInterval/updateInterval.
 *
 *   frac ≈ 0                     → start of act (startSceneId null, exact)
 *   frac = k/m, k∈[1,m-1] (snap) → startSceneId = scenes[k] (scene k starts at actIdx + k/m)
 *   any other frac in (0, 1)     → startSceneId null (free-fraction; the position
 *                                  REAL value carries the precision)
 *
 * Returns null only when position is out of range.
 *
 * @param position      position on the global story-time axis
 * @param acts          root-level Acts in index order
 * @param scenesByActId scenes per act, each list sorted by scene index
 */
export function positionToStartFKs(
	position: number,
	acts: { id: string }[],
	scenesByActId: Map<string, { id: string }[]>
): StartFKs | null {
	const actIdx = Math.floor(position);
	if (actIdx < 0 || actIdx >= acts.length) return null;
	const frac = position - actIdx;
	if (frac < 1e-9) {
		// Snap canonical position to the integer boundary.
		return { startActId: acts[actIdx].id, startSceneId: null, startPosition: actIdx };
	}
	const scenes = scenesByActId.get(acts[actIdx].id) ?? [];
	const m = scenes.length;
	if (m > 0) {
		// k: scene index whose range starts at frac (sceneRange(k, m, actIdx).start = actIdx + k/m)
		const k = Math.round(frac * m);
		const matches = Math.abs(frac * m - k) < 1e-9;
		if (matches && k >= 1 && k < m) {
			return {
				startActId: acts[actIdx].id,
				startSceneId: scenes[k].id,
				startPosition: actIdx + k / m
			};
		}
		// Off-grid or beyond scenes: fall through to free-fraction.
	}
	return { startActId: acts[actIdx].id, startSceneId: null, startPosition: position };
}

/**
 * Map an end position to FK references for writeInterval/updateInterval.
 *
 * End is exclusive; boundary k/m means the last included scene is k-1
 * (sceneRange(k-1, m, actIdx).end = actIdx + k/m).
 *
 *   position = acts.length      → end of story (last act, no scene FK)
 *   frac ≈ 1                    → end of act (endSceneId null, exact)
 *   frac = k/m (0 < k ≤ m, snap) → endSceneId = scenes[k-1]
 *   any other frac in (0, 1)    → endSceneId null (free-fraction; the position
 *                                 REAL value carries the precision)
 *
 * Returns null only when position is out of range.
 *
 * @param position      position on the global story-time axis
 * @param acts          root-level Acts in index order
 * @param scenesByActId scenes per act, each list sorted by scene index
 */
export function positionToEndFKs(
	position: number,
	acts: { id: string }[],
	scenesByActId: Map<string, { id: string }[]>
): EndFKs | null {
	if (Math.abs(position - acts.length) < 1e-9) {
		const last = acts[acts.length - 1];
		return last ? { endActId: last.id, endSceneId: null, endPosition: acts.length } : null;
	}
	// floor(position - ε): maps integer 2.0 → Act 1 (end-of-act), not Act 2 (start-of-act).
	const actIdx = Math.floor(position - 1e-9);
	if (actIdx < 0 || actIdx >= acts.length) return null;
	const frac = position - actIdx;
	if (frac > 1 - 1e-9) {
		// Snap canonical position to the integer boundary (actIdx + 1).
		return { endActId: acts[actIdx].id, endSceneId: null, endPosition: actIdx + 1 };
	}
	const scenes = scenesByActId.get(acts[actIdx].id) ?? [];
	const m = scenes.length;
	if (m > 0) {
		const k = Math.round(frac * m);
		const matches = Math.abs(frac * m - k) < 1e-9;
		if (matches && k >= 1 && k < m) {
			return {
				endActId: acts[actIdx].id,
				endSceneId: scenes[k - 1].id,
				endPosition: actIdx + k / m
			};
		}
		// Off-grid: fall through to free-fraction.
	}
	return { endActId: acts[actIdx].id, endSceneId: null, endPosition: position };
}

// ─── Act-boundary hairlines ───────────────────────────────────────────────────

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
