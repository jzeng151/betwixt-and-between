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
 */
import type { WorldMap } from './types/world-map.js';

export function resolveActiveVariant(
	maps: WorldMap[],
	locationId: string | null | undefined,
	playheadPosition: number | null | undefined
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

	// No default + playhead doesn't cover any scoped variant. Fall back to
	// the first candidate by createdAt order (caller's input order) so the UI
	// always renders *something* when maps exist; caller may surface a warning.
	return candidates[0] ?? null;
}

/**
 * All variants of a Location, sorted by start_position (default first).
 * Used by the variant editor + the map switcher to group + label variants.
 */
export function variantsForLocation(
	maps: WorldMap[],
	locationId: string | null | undefined
): WorldMap[] {
	if (!locationId) return [];
	return maps
		.filter((m) => m.locationId === locationId)
		.sort((a, b) => {
			const aDefault = a.startPosition === null;
			const bDefault = b.startPosition === null;
			if (aDefault && !bDefault) return -1;
			if (bDefault && !aDefault) return 1;
			if (aDefault && bDefault) return 0;
			return (a.startPosition ?? 0) - (b.startPosition ?? 0);
		});
}
