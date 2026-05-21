// Pure helpers for projecting story-time scope onto entities and edges.
//
// Extracted from inline duplication in StoryGraph.svelte + FocusedGraph.svelte.
// No Svelte runes, no stores — callers wrap these in `$derived` and pass plain
// arrays / maps / sets in.
//
// `intervalContainsT` is imported from the playhead store module because that
// is where it already lives as a pure helper; the import is type-and-pure-only.

import { intervalContainsT } from '$lib/stores/playhead.js';

export interface Interval {
	entityId: string;
	startPosition: number;
	endPosition: number;
}

export interface ScopeEntity {
	id: string;
	type: string;
	parentId?: string | null;
	position?: number | null;
}

export interface SceneRange {
	start: number;
	end: number;
}

export interface TemporalRelationship {
	fromId: string;
	toId: string;
	startPosition?: number | null;
	endPosition?: number | null;
}

export interface ScopeContext {
	t: number;
	sortedSceneStarts: number[];
	entityIntervalMap: Map<string, Array<{ startPosition: number; endPosition: number }>>;
	outOfScope: Set<string>;
}

export interface EdgeContext {
	inWindow: boolean;
	mystery: boolean;
	showGhostTrails: boolean;
}

export function buildEntityIntervalMap(
	intervals: Iterable<Interval>
): Map<string, Array<{ startPosition: number; endPosition: number }>> {
	const m = new Map<string, Array<{ startPosition: number; endPosition: number }>>();
	for (const iv of intervals) {
		const list = m.get(iv.entityId) ?? [];
		list.push(iv);
		m.set(iv.entityId, list);
	}
	return m;
}

// 1-indexed DB sort position → 0-based rank so playhead-axis math uses [0,1), [1,2), …
export function buildActIndexById(entities: Iterable<ScopeEntity>): Map<string, number> {
	return new Map(
		[...entities]
			.filter((e) => e.type === 'Act' && e.position != null)
			.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
			.map((e, i): [string, number] => [e.id, i])
	);
}

// Fractional sub-ranges for Scenes within their parent Act's [actIdx, actIdx+1)
// window. Scenes sort by explicit position when set, otherwise by iteration order
// from the input (= creation order, when callers pass `$entities`).
export function buildSceneRanges(
	entities: Iterable<ScopeEntity>,
	actIndexById: Map<string, number>
): Map<string, SceneRange> {
	const ranges = new Map<string, SceneRange>();
	const scenesByAct = new Map<string, Array<{ id: string; position: number | null }>>();
	for (const e of entities) {
		if (e.type === 'Scene' && e.parentId != null) {
			const list = scenesByAct.get(e.parentId) ?? [];
			list.push({ id: e.id, position: e.position ?? null });
			scenesByAct.set(e.parentId, list);
		}
	}
	for (const [actId, scenes] of scenesByAct) {
		const actIdx = actIndexById.get(actId);
		if (actIdx == null) continue;
		const sorted = [...scenes].sort((a, b) => {
			if (a.position != null && b.position != null) return a.position - b.position;
			if (a.position != null) return -1;
			if (b.position != null) return 1;
			return 0;
		});
		const n = sorted.length;
		for (let i = 0; i < n; i++) {
			ranges.set(sorted[i].id, { start: actIdx + i / n, end: actIdx + (i + 1) / n });
		}
	}
	return ranges;
}

export function extractSortedSceneStarts(sceneRanges: Map<string, SceneRange>): number[] {
	return [...sceneRanges.values()].map((r) => r.start).sort((a, b) => a - b);
}

// Scene-granular proximity: at most 2 scene boundaries between [lo, hi].
// Falls back to "within one act unit" when no scenes exist.
export function nearEnoughForGhostTrail(
	lo: number,
	hi: number,
	sortedSceneStarts: number[]
): boolean {
	return sortedSceneStarts.length > 0
		? sortedSceneStarts.filter((s) => s > lo + 1e-9 && s <= hi + 1e-9).length <= 2
		: hi - lo <= 1;
}

// An entity is "out of scope" at T when:
//   - it has intervals and none contain T (characters / events on the timeline)
//   - it is an Act whose [idx, idx+1) window does not contain T
//   - it is a Scene whose fractional sub-range does not contain T
export function computeOutOfScope(
	t: number | null,
	entityIntervalMap: Map<string, Array<{ startPosition: number; endPosition: number }>>,
	actIndexById: Map<string, number>,
	sceneRanges: Map<string, SceneRange>,
	displayEntities: Iterable<ScopeEntity>
): Set<string> {
	const set = new Set<string>();
	if (t == null) return set;

	for (const [entityId, ivs] of entityIntervalMap) {
		const active = ivs.some((iv) => intervalContainsT(iv.startPosition, iv.endPosition, t));
		if (!active) set.add(entityId);
	}

	for (const e of displayEntities) {
		if (e.type === 'Act') {
			const actIdx = actIndexById.get(e.id);
			if (actIdx != null && !intervalContainsT(actIdx, actIdx + 1, t)) set.add(e.id);
		} else if (e.type === 'Scene') {
			const range = sceneRanges.get(e.id);
			if (range != null && !intervalContainsT(range.start, range.end, t)) set.add(e.id);
		}
	}

	return set;
}

// Classify whether an edge should render as a 'past' or 'future' ghost trail,
// or null when it shouldn't ghost.
//
// Behavior note pinned by tests: when `startPosition` is set, past/future is
// decided by `startPosition > t` regardless of which endpoint (start or end)
// matched the proximity check. When `startPosition` is null and only
// `endPosition` matched, the function falls through to 'past'. This mirrors
// the pre-extraction inline logic; if intent is "future when only endPosition
// is in the future", treat that as a separate behavioral change.
export function classifyGhostMode(
	r: TemporalRelationship,
	scope: ScopeContext,
	edge: EdgeContext
): 'past' | 'future' | null {
	if (!edge.showGhostTrails || edge.mystery) return null;
	const endpointOutOfScope = scope.outOfScope.has(r.fromId) || scope.outOfScope.has(r.toId);
	if (edge.inWindow && !endpointOutOfScope) return null;

	const { t, sortedSceneStarts, entityIntervalMap } = scope;
	const near = (lo: number, hi: number) =>
		nearEnoughForGhostTrail(lo, hi, sortedSceneStarts);

	if (r.startPosition != null || r.endPosition != null) {
		const nearStart =
			r.startPosition != null &&
			near(Math.min(r.startPosition, t), Math.max(r.startPosition, t));
		const nearEnd =
			r.endPosition != null &&
			near(Math.min(r.endPosition, t), Math.max(r.endPosition, t));
		if (nearStart || nearEnd) {
			return r.startPosition != null && r.startPosition > t ? 'future' : 'past';
		}
		return null;
	}

	for (const endpointId of [r.fromId, r.toId]) {
		for (const iv of entityIntervalMap.get(endpointId) ?? []) {
			if (iv.endPosition <= t && near(iv.endPosition, t)) return 'past';
			if (iv.startPosition > t && near(t, iv.startPosition)) return 'future';
		}
	}
	return null;
}
