// Cinematic Spotlight (Slice 8) PR2 — "which Location at T?" resolver. Pins the
// scope rule mirrored from foldCausalEdges (projection.ts:727-746), the
// specificity ranking, and the ancestor-fallback + hysteresis the between-map
// cycling commit (Step D) drives.

import { describe, it, expect } from 'vitest';
import {
	groupTakesPlaceAt,
	eventLocationAtT,
	activeLocationsAtT,
	activeEventIdsAtT,
	diffNewlyActiveEvents,
	decideCycleAction,
	pickCyclingTarget,
	type TakesPlaceAtEntry,
	type ActiveLocation
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
	opts: {
		startPosition?: number | null;
		endPosition?: number | null;
		revealedAtPosition?: number | null;
	} = {}
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
		revealedAtPosition: opts.revealedAtPosition ?? null
	};
}

const tpa = (
	event: string,
	loc: string,
	bounds?: {
		startPosition?: number | null;
		endPosition?: number | null;
		revealedAtPosition?: number | null;
	}
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
			{ locationId: 'locA', startPosition: null, endPosition: null, revealedAtPosition: null },
			{ locationId: 'locB', startPosition: 0.2, endPosition: 0.8, revealedAtPosition: null }
		]);
		expect(g.get('e2')).toEqual([
			{ locationId: 'locC', startPosition: null, endPosition: null, revealedAtPosition: null }
		]);
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

	it('skips a reveal-gated edge until its revealedAtPosition (Codex PR #72)', () => {
		const entries: TakesPlaceAtEntry[] = [
			{ locationId: 'locSecret', startPosition: null, endPosition: null, revealedAtPosition: 0.6 }
		];
		expect(eventLocationAtT(entries, 0.5)).toBeNull(); // before reveal → hidden
		expect(eventLocationAtT(entries, 0.6)).toBe('locSecret'); // at reveal → visible
		expect(eventLocationAtT(entries, 0.9)).toBe('locSecret'); // after reveal → visible
	});

	it('falls back to a visible edge while another is still reveal-gated', () => {
		const entries: TakesPlaceAtEntry[] = [
			{ locationId: 'locSecret', startPosition: null, endPosition: null, revealedAtPosition: 0.6 },
			{ locationId: 'locPublic', startPosition: null, endPosition: null }
		];
		// Before reveal the gated edge is skipped, so the public one wins.
		expect(eventLocationAtT(entries, 0.5)).toBe('locPublic');
	});
});

describe('activeLocationsAtT — specificity ranking', () => {
	// Hierarchy: root → mid → leaf (depths 0,1,2).
	const hierarchy = [partOf('mid', 'root'), partOf('leaf', 'mid')];
	// Helper: just the ranked ids (most of these tests only care about ordering).
	const ids = (rels: Relationship[], t: number) =>
		activeLocationsAtT(rels, t).map((l) => l.locationId);

	it('returns distinct active Locations, deepest-first', () => {
		const rels = [
			...hierarchy,
			tpa('e1', 'root'),
			tpa('e2', 'leaf'),
			tpa('e3', 'mid'),
			tpa('e4', 'leaf') // duplicate active loc — distinct in output
		];
		expect(ids(rels, 0.5)).toEqual(['leaf', 'mid', 'root']);
	});

	it('excludes Locations whose only event is out of window at T', () => {
		const rels = [
			...hierarchy,
			tpa('e1', 'leaf', { startPosition: 0.0, endPosition: 0.3 }),
			tpa('e2', 'root')
		];
		expect(ids(rels, 0.5)).toEqual(['root']); // leaf's window closed
		expect(ids(rels, 0.1)).toEqual(['leaf', 'root']);
	});

	it('excludes a reveal-gated Location so cycling never spoils a hidden map (Codex PR #72)', () => {
		const rels = [
			...hierarchy,
			tpa('e1', 'leaf', { revealedAtPosition: 0.6 }), // mystery: leaf hidden until 0.6
			tpa('e2', 'root')
		];
		expect(ids(rels, 0.5)).toEqual(['root']); // before reveal → leaf not a cycle target
		expect(ids(rels, 0.7)).toEqual(['leaf', 'root']); // after reveal → leaf active
	});

	it('tags each active Location with whether it is scoped at T', () => {
		const rels = [
			...hierarchy,
			tpa('e1', 'leaf', { startPosition: 0.0, endPosition: 0.6 }), // scoped, active at 0.3
			tpa('e2', 'root') // timeless
		];
		expect(activeLocationsAtT(rels, 0.3)).toEqual([
			{ locationId: 'leaf', scoped: true },
			{ locationId: 'root', scoped: false }
		]);
	});
});

describe('activeEventIdsAtT — caption selection (T9 reuses the resolver)', () => {
	it('returns Events with a takes_place_at visible at T', () => {
		const rels = [
			tpa('e1', 'locA'),
			tpa('e2', 'locB', { startPosition: 0.0, endPosition: 0.3 }),
			tpa('e3', 'locC', { startPosition: 0.5, endPosition: 1.0 })
		];
		expect(activeEventIdsAtT(rels, 0.1).sort()).toEqual(['e1', 'e2']); // e3 closed
		expect(activeEventIdsAtT(rels, 0.7).sort()).toEqual(['e1', 'e3']); // e2 closed
	});

	it('excludes a reveal-gated Event until it is revealed (Codex PR #72)', () => {
		const rels = [tpa('e1', 'locA', { revealedAtPosition: 0.6 })];
		expect(activeEventIdsAtT(rels, 0.5)).toEqual([]); // before reveal → no caption
		expect(activeEventIdsAtT(rels, 0.7)).toEqual(['e1']); // after reveal → caption fires
	});

	it('returns [] when no Event is active at T', () => {
		const rels = [tpa('e1', 'locA', { startPosition: 0.0, endPosition: 0.2 })];
		expect(activeEventIdsAtT(rels, 0.9)).toEqual([]);
	});
});

describe('pickCyclingTarget — scoped precedence + ancestor fallback + hysteresis', () => {
	// root → mid → leaf. Only root and mid have maps; leaf does not.
	const index = buildHierarchyIndex([partOf('mid', 'root'), partOf('leaf', 'mid')]);
	const hasMap = (id: string) => id === 'root' || id === 'mid';
	// ActiveLocation builders: scoped (transient beat) vs timeless (always-on link).
	const sc = (locationId: string): ActiveLocation => ({ locationId, scoped: true });
	const tl = (locationId: string): ActiveLocation => ({ locationId, scoped: false });

	it('resolves the most-specific active Location to its own map when it has one', () => {
		expect(pickCyclingTarget([sc('mid'), sc('root')], hasMap, index, null)).toBe('mid');
	});

	it('falls back to the nearest map-bearing ancestor when the deepest has no map', () => {
		// leaf is most specific but mapless → nearest ancestor with a map is mid.
		expect(pickCyclingTarget([sc('leaf')], hasMap, index, null)).toBe('mid');
	});

	it('holds prevTarget while it is still a SCOPED target (anti-strobe)', () => {
		// On root (prev). A brief simultaneous scoped beat adds leaf→mid; since root
		// is still a scoped target, hold root rather than strobe to mid.
		expect(pickCyclingTarget([sc('leaf'), sc('root')], hasMap, index, 'root')).toBe('root');
	});

	it('moves to the most-specific scoped map when prevTarget is no longer scoped-active', () => {
		// root no longer active; only scoped leaf (→mid) is → switch to mid.
		expect(pickCyclingTarget([sc('leaf')], hasMap, index, 'root')).toBe('mid');
	});

	// ── Scoped-over-timeless (product decision 2026-06-06 / #384) ──────────────
	it('a scoped map displays over a timeless one', () => {
		// root is timeless-active (always on); mid is scoped-active now → mid wins.
		expect(pickCyclingTarget([sc('mid'), tl('root')], hasMap, index, null)).toBe('mid');
	});

	it('a timeless prevTarget does NOT lock the camera — a scoped beat elsewhere wins (#384)', () => {
		// On root via a timeless edge (prev=root). A scoped beat fires at mid. The old
		// rule held root forever; now mid wins because timeless never triggers hysteresis.
		expect(pickCyclingTarget([sc('mid'), tl('root')], hasMap, index, 'root')).toBe('mid');
	});

	it('switches back to the timeless map once no scoped target remains', () => {
		// Scoped beat ended; only the timeless root link is active → return to root,
		// even though we were previously showing mid.
		expect(pickCyclingTarget([tl('root')], hasMap, index, 'mid')).toBe('root');
	});

	it('among timeless-only targets, the most-specific wins (deterministic, no strobe)', () => {
		expect(pickCyclingTarget([tl('mid'), tl('root')], hasMap, index, 'root')).toBe('mid');
	});

	it('holds (returns prevTarget) when no active Location resolves to a map', () => {
		const noMaps = () => false;
		expect(pickCyclingTarget([sc('leaf'), tl('root')], noMaps, index, 'root')).toBe('root');
		expect(pickCyclingTarget([sc('leaf')], noMaps, index, null)).toBeNull();
	});

	it('holds prevTarget when there are no active Locations at all', () => {
		expect(pickCyclingTarget([], hasMap, index, 'mid')).toBe('mid');
	});
});

describe('diffNewlyActiveEvents — caption frame diff', () => {
	it('returns only ids absent from the previous frame', () => {
		expect(diffNewlyActiveEvents(new Set(['a']), ['a', 'b'])).toEqual(['b']);
	});

	it('returns all ids when the previous frame was empty', () => {
		expect(diffNewlyActiveEvents(new Set(), ['a', 'b'])).toEqual(['a', 'b']);
	});

	it('does not re-emit an id that was already active', () => {
		expect(diffNewlyActiveEvents(new Set(['a', 'b']), ['a', 'b'])).toEqual([]);
	});

	it('re-emits after an idle reset (baseline cleared to empty)', () => {
		// active → idle(clear) → active again: the same id must re-title.
		const afterIdle = new Set<string>();
		expect(diffNewlyActiveEvents(afterIdle, ['a'])).toEqual(['a']);
	});

	it('preserves the input order so captions fire in resolver order', () => {
		expect(diffNewlyActiveEvents(new Set(['b']), ['c', 'b', 'a'])).toEqual(['c', 'a']);
	});
});

describe('decideCycleAction — switch-only-when-ready', () => {
	it('holds when there is no target', () => {
		expect(decideCycleAction(null, 'mapA', false)).toBe('hold');
		expect(decideCycleAction(null, 'mapA', true)).toBe('hold');
	});

	it('holds when the target is already the active map', () => {
		expect(decideCycleAction('mapA', 'mapA', true)).toBe('hold');
		expect(decideCycleAction('mapA', 'mapA', false)).toBe('hold');
	});

	it('commits when the target differs and its regions are cached', () => {
		expect(decideCycleAction('mapB', 'mapA', true)).toBe('commit');
	});

	it('prefetches (holds the current map) when the target differs but is not cached', () => {
		expect(decideCycleAction('mapB', 'mapA', false)).toBe('prefetch');
	});

	it('commits a first switch from no active map when cached', () => {
		expect(decideCycleAction('mapA', null, true)).toBe('commit');
		expect(decideCycleAction('mapA', null, false)).toBe('prefetch');
	});
});

describe('shared takes_place_at index passthrough (eng decision #5)', () => {
	const hierarchy = [partOf('mid', 'root'), partOf('leaf', 'mid')];
	const rels = [...hierarchy, tpa('e1', 'root'), tpa('e2', 'leaf'), tpa('e3', 'mid')];

	it('activeLocationsAtT yields the same result with a pre-built byEvent index', () => {
		const byEvent = groupTakesPlaceAt(rels);
		const index = buildHierarchyIndex(rels);
		expect(activeLocationsAtT(rels, 0.5, index, byEvent)).toEqual(
			activeLocationsAtT(rels, 0.5, index)
		);
	});

	it('activeEventIdsAtT yields the same result with a pre-built byEvent index', () => {
		const byEvent = groupTakesPlaceAt(rels);
		expect(activeEventIdsAtT(rels, 0.5, byEvent).sort()).toEqual(
			activeEventIdsAtT(rels, 0.5).sort()
		);
	});
});
