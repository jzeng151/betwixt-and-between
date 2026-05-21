// Pure helpers for graph view-model construction (node + edge projection).
//
// Extracted from inline duplication in StoryGraph.svelte + FocusedGraph.svelte.
// No Svelte runes, no stores — callers wrap these in `$derived` and pass plain
// arrays / sets in.
//
// Note on what's NOT in here: `buildNodeColorById` was reviewed for extraction
// and intentionally left inline. FocusedGraph is a per-window subset view and
// per-window color overrides is a plausible near-term feature that would fork
// the helper. The two existing call sites are 7 LOC and tightly coupled to
// their `graphNodes` $derived; sharing them now would be a weak abstraction.

import type { RelationshipType } from '$lib/server/db/schema.js';
import type { SceneRange } from '$lib/features/graph/scope.js';

export interface IndexableEntity {
	id: string;
	type: string;
}

export interface NamedSceneEntity {
	id: string;
	name: string;
	parentId?: string | null;
}

export interface SceneRevealEntry {
	id: string;
	name: string;
	actId: string;
	position: number;
}

export interface TypedRelationship {
	fromId: string;
	toId: string;
	type: RelationshipType;
}

export interface AliasEntry {
	primaryEntityId: string;
	aliasEntityId: string;
}

// Position of each Character in the filtered Character list. Lets graph nodes
// pick the same color cycle the Timeline uses.
export function buildCharacterIndexById(
	entities: Iterable<IndexableEntity>
): Map<string, number> {
	const m = new Map<string, number>();
	let i = 0;
	for (const e of entities) {
		if (e.type === 'Character') {
			m.set(e.id, i);
			i++;
		}
	}
	return m;
}

// Set of rel types that have at least one edge between two displayed entities,
// computed BEFORE the Legend filter. Drives Legend's per-row dim for absent
// types so the user sees which connections actually exist on this view.
export function buildPresentRelTypes(
	relationships: Iterable<TypedRelationship>,
	displayEntityIds: Set<string>
): Set<RelationshipType> {
	const s = new Set<RelationshipType>();
	for (const r of relationships) {
		if (displayEntityIds.has(r.fromId) && displayEntityIds.has(r.toId)) {
			s.add(r.type);
		}
	}
	return s;
}

// Union of every entity that is either the primary or the alias side of any
// alias pair. Used to flag the `aliasMember` boolean on GraphNode props.
export function buildAliasEntityIdSet(aliases: Iterable<AliasEntry>): Set<string> {
	const s = new Set<string>();
	for (const a of aliases) {
		s.add(a.primaryEntityId);
		s.add(a.aliasEntityId);
	}
	return s;
}

// Filter relationships down to those whose endpoints are both currently rendered.
// Generic on R so callers preserve the relationship's full shape.
export function filterVisibleRelationships<R extends { fromId: string; toId: string }>(
	relationships: Iterable<R>,
	renderedEntityIds: Set<string>
): R[] {
	const out: R[] = [];
	for (const r of relationships) {
		if (renderedEntityIds.has(r.fromId) && renderedEntityIds.has(r.toId)) {
			out.push(r);
		}
	}
	return out;
}

// Project sceneRanges into the shape the "Revealed at" dropdowns consume:
// {id, name, actId, position}. Sorted ascending by start position.
// Iterates entities once (O(n)) to look up names by id, avoiding the O(n²)
// inline `entities.find(...)` pattern the two components were using.
export function buildScenesForReveal(
	sceneRanges: Map<string, SceneRange>,
	entities: Iterable<NamedSceneEntity>
): SceneRevealEntry[] {
	const byId = new Map<string, NamedSceneEntity>();
	for (const e of entities) byId.set(e.id, e);

	const out: SceneRevealEntry[] = [];
	for (const [id, range] of sceneRanges) {
		const e = byId.get(id);
		if (e?.parentId) {
			out.push({ id, name: e.name, actId: e.parentId, position: range.start });
		}
	}
	return out.sort((a, b) => a.position - b.position);
}
