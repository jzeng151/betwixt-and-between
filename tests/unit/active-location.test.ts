// Cinematic Spotlight (Slice 8) PR2 — "which Location at T?" resolver. Pins the
// scope rule mirrored from foldCausalEdges (projection.ts:727-746), the
// specificity ranking, and the ancestor-fallback + hysteresis the between-map
// cycling commit (Step D) drives.

import { describe, it, expect } from 'vitest';
import {
	groupTakesPlaceAt,
	eventLocationAtT,
	activeLocationsAtT,
	pickCyclingTarget,
	type TakesPlaceAtEntry
} from '../../src/lib/features/map/active-location.js';
import { buildHierarchyIndex } from '../../src/lib/location-hierarchy.js';
import type { Relationship } from '../../src/lib/stores/relationships.js';
import type { RelationshipType } from '../../src/lib/server/db/schema.js';

// Relationship factory — only the fields the resolver reads vary; the rest are
// the inert nulls every row carries.
function rel(
	type: RelationshipType,
	fromId: string,
	toId: string,
	opts: { startPosition?: number | null; endPosition?: number | null } = {}
): Relationship {
	return {
		id: `${type}:${fromId}->${toId}`,
		fromId,
		toId,
		type,
		label: null,
		startActId: null,
		startSceneId: null,
		endActId: null,
		endSceneId: null,
		startPosition: opts.startPosition ?? null,
		endPosition: opts.endPosition ?? null,
		revealedAtPosition: null
	};
}

const tpa = (
	event: string,
	loc: string,
	bounds?: { startPosition?: number | null; endPosition?: number | null }
) => rel('takes_place_at', event, loc, bounds);
const partOf = (child: string, parent: string) => rel('part_of', child, parent);

describe('groupTakesPlaceAt', () => {
	it('groups takes_place_at by Event endpoint, ignoring other types', () => {
		const g = groupTakesPlaceAt([
			tpa('e1', 'locA'),
			tpa('e1', 'locB', { startPosition: 0.2, endPosition: 0.8 }),
			tpa('e2', 'locC'),
			partOf('locA', 'locRoot'),
			rel('caused_by', 'e2', 'e1')
		]);
		expect(g.get('e1')).toEqual<TakesPlaceAtEntry[]>([
			{ locationId: 'locA', startPosition: null, endPosition: null },
			{ locationId: 'locB', startPosition: 0.2, endPosition: 0.8 }
		]);
		expect(g.get('e2')).toEqual([{ locationId: 'locC', startPosition: null, endPosition: null }]);
		expect(g.has('caused_by:e2->e1' as never)).toBe(false);
	});
});

describe('eventLocationAtT — mirrors foldCausalEdges.locationAtT', () => {
	it('returns null when the Event has no takes_place_at', () => {
		expect(eventLocationAtT(undefined, 0.5)).toBeNull();
		expect(eventLocationAtT([], 0.5)).toBeNull();
	});

	it('skips edges not visible at T', () => {
		const entries: TakesPlaceAtEntry[] = [
			{ locationId: 'locA', startPosition: 0.0, endPosition: 0.3 }
		];
		expect(eventLocationAtT(entries, 0.5)).toBeNull(); // outside [0,0.3)
		expect(eventLocationAtT(entries, 0.1)).toBe('locA');
	});

	it('prefers a scoped edge over a timeless one (more specific)', () => {
		const entries: TakesPlaceAtEntry[] = [
			{ locationId: 'locTimeless', startPosition: null, endPosition: null },
			{ locationId: 'locScoped', startPosition: 0.2, endPosition: 0.8 }
		];
		expect(eventLocationAtT(entries, 0.5)).toBe('locScoped');
		// Outside the scoped window only the timeless one is visible.
		expect(eventLocationAtT(entries, 0.9)).toBe('locTimeless');
	});

	it('breaks ties by lowest locationId among same-scoped-ness edges', () => {
		const entries: TakesPlaceAtEntry[] = [
			{ locationId: 'locZ', startPosition: null, endPosition: null },
			{ locationId: 'locA', startPosition: null, endPosition: null }
		];
		expect(eventLocationAtT(entries, 0.5)).toBe('locA');
	});
});

describe('activeLocationsAtT — specificity ranking', () => {
	// Hierarchy: root → mid → leaf (depths 0,1,2).
	const hierarchy = [partOf('mid', 'root'), partOf('leaf', 'mid')];

	it('returns distinct active Locations, deepest-first', () => {
		const rels = [
			...hierarchy,
			tpa('e1', 'root'),
			tpa('e2', 'leaf'),
			tpa('e3', 'mid'),
			tpa('e4', 'leaf') // duplicate active loc — distinct in output
		];
		expect(activeLocationsAtT(rels, 0.5)).toEqual(['leaf', 'mid', 'root']);
	});

	it('excludes Locations whose only event is out of window at T', () => {
		const rels = [
			...hierarchy,
			tpa('e1', 'leaf', { startPosition: 0.0, endPosition: 0.3 }),
			tpa('e2', 'root')
		];
		expect(activeLocationsAtT(rels, 0.5)).toEqual(['root']); // leaf's window closed
		expect(activeLocationsAtT(rels, 0.1)).toEqual(['leaf', 'root']);
	});
});

describe('pickCyclingTarget — ancestor fallback + hysteresis', () => {
	// root → mid → leaf. Only root and mid have maps; leaf does not.
	const index = buildHierarchyIndex([partOf('mid', 'root'), partOf('leaf', 'mid')]);
	const hasMap = (id: string) => id === 'root' || id === 'mid';

	it('resolves the most-specific active Location to its own map when it has one', () => {
		expect(pickCyclingTarget(['mid', 'root'], hasMap, index, null)).toBe('mid');
	});

	it('falls back to the nearest map-bearing ancestor when the deepest has no map', () => {
		// leaf is most specific but mapless → nearest ancestor with a map is mid.
		expect(pickCyclingTarget(['leaf'], hasMap, index, null)).toBe('mid');
	});

	it('holds prevTarget while it still covers an active Location (anti-strobe)', () => {
		// Story is at root (prev). A brief simultaneous scope adds leaf→mid; since
		// root still resolves an active Location, hold root rather than strobe to mid.
		expect(pickCyclingTarget(['leaf', 'root'], hasMap, index, 'root')).toBe('root');
	});

	it('moves to the most-specific map when prevTarget no longer covers any active Location', () => {
		// root is no longer active; only leaf (→mid) is → switch to mid.
		expect(pickCyclingTarget(['leaf'], hasMap, index, 'root')).toBe('mid');
	});

	it('holds (returns prevTarget) when no active Location resolves to a map', () => {
		const noMaps = () => false;
		expect(pickCyclingTarget(['leaf', 'root'], noMaps, index, 'root')).toBe('root');
		expect(pickCyclingTarget(['leaf'], noMaps, index, null)).toBeNull();
	});

	it('holds prevTarget when there are no active Locations at all', () => {
		expect(pickCyclingTarget([], hasMap, index, 'mid')).toBe('mid');
	});
});
