/**
 * Variant resolution — picks the world_map row that should render for a given
 * Location at a given playhead position.
 *
 * Per M3 (design doc), this resolver is pure and synchronous so the playhead
 * tick path stays DB-free. The active-Location subtree's variants are loaded
 * on scene change (worldMapStore.loadMaps); resolveActiveVariant is called per
 * render against the in-memory snapshot.
 *
 * Resolution rule (M9 invariants make this unambiguous):
 *   1. Filter to maps linked to the target locationId.
 *   2. If any variant's [start_position, end_position) covers the playhead,
 *      that variant wins. (EXCLUDE constraint guarantees at most one match.)
 *   3. Otherwise the default variant wins (start_position IS NULL).
 *      partial-unique guarantees at most one default per Location.
 *   4. If no default exists either, return null (the Location has no map
 *      authored for this story-time slice — UI should surface as "no map").
 *
 * `opts.strict` drops rule-4's first-candidate fallback: a Location counts as
 * map-bearing at T ONLY if a scoped variant covers T or a default exists. The
 * UI wants the fallback (always render something); the spotlight cycling
 * resolver wants strict so an out-of-window-only variant doesn't masquerade as
 * a current map and pre-empt the nearest-map-bearing-ancestor fallback (Codex
 * PR #72).
 */
import type { WorldMap } from './types.js';

export function resolveActiveVariant(
	maps: WorldMap[],
	locationId: string | null | undefined,
	playheadPosition: number | null | undefined,
	opts?: { strict?: boolean }
): WorldMap | null {
	if (!locationId) return null;
	const candidates = maps.filter((m) => m.locationId === locationId);
	if (candidates.length === 0) return null;

	if (playheadPosition !== null && playheadPosition !== undefined) {
		const scoped = candidates.find(
			(m) =>
				m.startPosition !== null &&
				m.endPosition !== null &&
				m.startPosition <= playheadPosition &&
				playheadPosition < m.endPosition
		);
		if (scoped) return scoped;
	}

	const defaultVariant = candidates.find(
		(m) => m.startPosition === null && m.endPosition === null
	);
	if (defaultVariant) return defaultVariant;

	// No default + playhead doesn't cover any scoped variant. Strict callers
	// (cycling) treat this as "no current map" so the ancestor fallback applies;
	// the UI falls back to the first candidate by createdAt order (caller's input
	// order) so it always renders *something* when maps exist.
	if (opts?.strict) return null;
	return candidates[0] ?? null;
}
