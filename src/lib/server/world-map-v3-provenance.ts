// World Map v3 Slice 5 PR-E (D6, ADR 0006) — Causal Cartography provenance walk.
//
// "Why is this region the way it is at time T?" Given a region and a playhead
// position, trace the recorded causal lineage:
//
//   region changed at T  →  the transfer_region map_event that set it (latest
//   ≤ T)  →  that event's source_event_id Event (the recorded cause)  →  the
//   `caused_by` ancestry of that Event (BFS to the earliest root)  →  offer a
//   jump to where the earliest cause is scoped.
//
// `caused_by` is `effect ← cause`: in a relationship row fromId = effect,
// toId = cause (edge-policy.ts:15). So "the causes of event X" are the toId of
// caused_by rows with fromId = X. `caused_by` is NOT cycle-checked at write, so
// the BFS carries a visited-set guard (a → b → a must terminate).
//
// Cross-user defense (CLAUDE.md): the change-event read is scoped through
// world_maps.user_id (assertMapOwnership); every ancestry hop inner-joins the
// cause endpoint to entities.user_id, so a foreign-owned ancestor is never
// returned and the walk simply stops at the ownership boundary. This is one
// query PER BFS node (not "one query") — fine at single-user N; there is no
// (type, fromId) ancestry index.

import { and, desc, eq, sql } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { entities, mapEvents, relationships, worldMaps } from './db/schema.js';
import type { Db } from './intervals.js';

// One node in the traced lineage. `viaRelationshipId` / `startPosition` describe
// the caused_by edge that led INTO this node from its child in the chain; both
// are null for the source node (the change's recorded cause — nothing led to it
// within the chain).
export type CauseStep = {
	eventId: string;
	name: string;
	viaRelationshipId: string | null;
	startPosition: number | null;
};

export type ProvenanceResult =
	// No transfer_region change for this region at/before T — nothing to trace.
	| { status: 'no-change' }
	// The change exists but carries no recorded cause (source_event_id null, or
	// its Event was deleted — the FK is ON DELETE SET NULL).
	| { status: 'no-cause' }
	// A recorded cause was found. `chain` is ordered source → … → earliest;
	// `earliest` is the root of the causal lineage; `jumpPosition` is the
	// startPosition of the caused_by edge entering the earliest cause (null when
	// the source itself is the root, or that edge is timeless — a no-op jump, D5).
	| {
			status: 'found';
			chain: CauseStep[];
			earliest: CauseStep;
			jumpPosition: number | null;
	  };

type AncestryHop = {
	fromId: string; // the child (effect) we came from
	relationshipId: string;
	startPosition: number | null;
	name: string;
};

/**
 * Trace the causal provenance of a region's state at time `t`. See module
 * header. Pure read; scoped to `userId` on both the map and every ancestry hop.
 */
export async function traceRegionProvenance(
	db: Db,
	userId: string,
	worldMapId: string,
	regionId: string,
	t: number
): Promise<ProvenanceResult> {
	await assertMapOwnership(db, userId, worldMapId);

	// 1) The latest recorded ownership claim for this region ≤ T: the most recent
	// live transfer_region event whose payload region_id matches. NOTE this is
	// the latest *event*, not an anchor-aware fold — D6 defines the trigger as
	// "the transfer_region event touching the region." In the normal case the
	// latest event ≤ T is exactly the change in effect; the one divergence is a
	// hand-authored anchor (snapshotWorldState) that sets a faction with no
	// corresponding event — there is then no event to attribute, and the walk
	// reports the most recent prior claim (or 'no-change' if none). Ordering
	// mirrors projection's same-T tiebreak (tPosition, createdAt, id).
	const [change] = await db
		.select({ sourceEventId: mapEvents.sourceEventId })
		.from(mapEvents)
		.where(
			and(
				eq(mapEvents.worldMapId, worldMapId),
				eq(mapEvents.kind, 'transfer_region'),
				sql`${mapEvents.payloadJsonb} ->> 'region_id' = ${regionId}`,
				sql`${mapEvents.tPosition} <= ${t}`,
				sql`${mapEvents.undoneAt} IS NULL`
			)
		)
		.orderBy(desc(mapEvents.tPosition), desc(mapEvents.createdAt), desc(mapEvents.id))
		.limit(1);

	if (!change) return { status: 'no-change' };
	if (!change.sourceEventId) return { status: 'no-cause' };

	// 2) The recorded cause Event, scoped to the user. If it was deleted (FK
	// SET NULL would have nulled it) or is somehow not an owned Event, degrade.
	const [sourceEvent] = await db
		.select({ id: entities.id, name: entities.name })
		.from(entities)
		.where(
			and(eq(entities.id, change.sourceEventId), eq(entities.userId, userId), eq(entities.type, 'Event'))
		);
	if (!sourceEvent) return { status: 'no-cause' };

	// 3) Walk the caused_by ancestry in two phases. Two gates on each edge:
	//    - ownership (relationships.user_id AND entities.user_id) — an imported /
	//      cross-user edge or ancestor is excluded → walk stops at the boundary;
	//    - reveal (revealedAtPosition) — a link not yet revealed to the reader at T
	//      is treated as not-yet-existing, so the walk never surfaces a hidden
	//      cause's name or story-time (mirrors the map render's spoiler posture).
	//      Gated on reveal ONLY, not isEdgeVisibleAtT's window — provenance is
	//      timeless causal lineage, and only reader-knowledge is a spoiler.

	// Phase A — discover the admissible ancestry subgraph. Each node is fetched
	// EXACTLY ONCE (a `nodes` set dedups the frontier), so this terminates even
	// when caused_by has a cycle (it isn't cycle-checked at write).
	type AdjEdge = {
		causeId: string;
		relationshipId: string;
		startPosition: number | null;
		name: string;
	};
	const adj = new Map<string, AdjEdge[]>(); // node → its admissible outgoing cause edges
	const nodes = new Set<string>([sourceEvent.id]);
	const frontier: string[] = [sourceEvent.id];
	while (frontier.length > 0) {
		const node = frontier.shift()!;
		const rows = await db
			.select({
				relationshipId: relationships.id,
				causeId: relationships.toId,
				startPosition: relationships.startPosition,
				revealedAtPosition: relationships.revealedAtPosition,
				causeName: entities.name
			})
			.from(relationships)
			.innerJoin(entities, eq(entities.id, relationships.toId))
			.where(
				and(
					eq(relationships.type, 'caused_by'),
					eq(relationships.fromId, node),
					eq(relationships.userId, userId),
					eq(entities.userId, userId)
				)
			);
		const edges: AdjEdge[] = [];
		for (const c of rows) {
			if (c.revealedAtPosition != null && t < c.revealedAtPosition) continue; // reveal gate
			edges.push({
				causeId: c.causeId,
				relationshipId: c.relationshipId,
				startPosition: c.startPosition,
				name: c.causeName
			});
			if (!nodes.has(c.causeId)) {
				nodes.add(c.causeId);
				frontier.push(c.causeId);
			}
		}
		adj.set(node, edges);
	}

	// Phase B — longest path from source to each node, so the deepest ROOT is the
	// MOST ancestral cause (Codex review #66). Topological-sort DP (Kahn) when the
	// subgraph is acyclic: dist relaxes forward and each parent has strictly
	// smaller dist than its child, so the hop chain can't cycle and reconstruction
	// always terminates at the source. If a cycle is present (a data error —
	// caused_by isn't cycle-checked), fall back to a safe set-once BFS tree.
	const depth = new Map<string, number>([[sourceEvent.id, 0]]);
	const hopInto = new Map<string, AncestryHop>(); // causeId → the edge that set its depth

	const indeg = new Map<string, number>();
	for (const n of nodes) indeg.set(n, 0);
	for (const edges of adj.values()) for (const e of edges) indeg.set(e.causeId, (indeg.get(e.causeId) ?? 0) + 1);
	const kahn: string[] = [];
	for (const n of nodes) if ((indeg.get(n) ?? 0) === 0 && !depth.has(n)) depth.set(n, 0);
	for (const n of nodes) if ((indeg.get(n) ?? 0) === 0) kahn.push(n);
	let processed = 0;
	while (kahn.length > 0) {
		const node = kahn.shift()!;
		processed++;
		const dn = depth.get(node) ?? 0;
		for (const e of adj.get(node) ?? []) {
			if (dn + 1 > (depth.get(e.causeId) ?? -1)) {
				depth.set(e.causeId, dn + 1);
				hopInto.set(e.causeId, {
					fromId: node,
					relationshipId: e.relationshipId,
					startPosition: e.startPosition,
					name: e.name
				});
			}
			const d = (indeg.get(e.causeId) ?? 0) - 1;
			indeg.set(e.causeId, d);
			if (d === 0) kahn.push(e.causeId);
		}
	}
	if (processed < nodes.size) {
		// Cycle in the discovered subgraph → topo order is undefined. Fall back to a
		// set-once BFS tree (each hop set once → tree → reconstruction terminates).
		depth.clear();
		hopInto.clear();
		depth.set(sourceEvent.id, 0);
		const visited = new Set<string>([sourceEvent.id]);
		const bq: string[] = [sourceEvent.id];
		while (bq.length > 0) {
			const node = bq.shift()!;
			for (const e of adj.get(node) ?? []) {
				if (visited.has(e.causeId)) continue;
				visited.add(e.causeId);
				depth.set(e.causeId, (depth.get(node) ?? 0) + 1);
				hopInto.set(e.causeId, {
					fromId: node,
					relationshipId: e.relationshipId,
					startPosition: e.startPosition,
					name: e.name
				});
				bq.push(e.causeId);
			}
		}
	}

	// Earliest cause = the deepest ROOT (no admissible outgoing cause), tie-broken
	// by lowest id. If every reachable node has a cause (a pure cycle), fall back
	// to the deepest visited node so the walk still returns a defined answer.
	const roots = [...nodes].filter((n) => (adj.get(n)?.length ?? 0) === 0);
	const candidates = roots.length > 0 ? roots : [...nodes];
	let earliestId = sourceEvent.id;
	let bestDepth = -1;
	for (const id of candidates) {
		const d = depth.get(id) ?? 0;
		if (d > bestDepth || (d === bestDepth && id < earliestId)) {
			bestDepth = d;
			earliestId = id;
		}
	}

	// 4) Reconstruct the chain source → … → earliest via the hop map. `hopInto` is
	// a tree (set once per node), so this terminates at the source; the seen guard
	// is defensive belt-and-suspenders against any future hop-rewrite regression.
	const reversed: CauseStep[] = [];
	const seenInChain = new Set<string>();
	let cursor: string | null = earliestId;
	while (cursor && cursor !== sourceEvent.id) {
		if (seenInChain.has(cursor)) break; // cyclic hop chain — stop (defensive)
		seenInChain.add(cursor);
		const hop = hopInto.get(cursor);
		if (!hop) break;
		reversed.push({
			eventId: cursor,
			name: hop.name,
			viaRelationshipId: hop.relationshipId,
			startPosition: hop.startPosition
		});
		cursor = hop.fromId;
	}
	const sourceStep: CauseStep = {
		eventId: sourceEvent.id,
		name: sourceEvent.name,
		viaRelationshipId: null,
		startPosition: null
	};
	const chain: CauseStep[] = [sourceStep, ...reversed.reverse()];
	const earliest = chain[chain.length - 1];

	return { status: 'found', chain, earliest, jumpPosition: earliest.startPosition };
}

// Local copy of the ownership guard (world-map-v3.ts's is module-private). Keeps
// the provenance read scoped to world_maps.user_id without widening that file's
// export surface.
async function assertMapOwnership(db: Db, userId: string, worldMapId: string): Promise<void> {
	const [row] = await db
		.select({ id: worldMaps.id })
		.from(worldMaps)
		.where(and(eq(worldMaps.id, worldMapId), eq(worldMaps.userId, userId)));
	if (!row) error(404, 'Map not found');
}
