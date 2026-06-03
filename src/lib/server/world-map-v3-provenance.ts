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

	// 3) BFS the caused_by ancestry, visited-guarded. Two gates on each hop:
	//    - ownership (inner-join entities.user_id) — a cross-user ancestor is
	//      excluded → walk stops at the boundary;
	//    - reveal (revealedAtPosition) — a `caused_by` link not yet revealed to
	//      the reader at T is treated as not-yet-existing, so the walk stops
	//      there and never surfaces a hidden cause's name or story-time. This
	//      mirrors the map render's strict spoiler posture (projection.ts
	//      foldCausalEdges + jump-to-cause.isCausalEdgeClickable). NOTE we gate on
	//      reveal only, NOT on isEdgeVisibleAtT's temporal window — provenance is
	//      timeless causal lineage ("what caused this"), not "which edges are
	//      active right now"; only reader-knowledge (reveal) is a spoiler.
	// Plain breadth-first tree walk: each node's hop is set EXACTLY ONCE, at first
	// discovery, so `hopInto` is always a tree rooted at the source and chain
	// reconstruction is guaranteed to terminate at the source. (An earlier
	// longest-path relaxation that rewrote hops on re-discovery was reverted: it
	// could rewrite a non-source cycle's hops to point only at each other and hang
	// reconstruction — Codex review #66 P1. The cost is a documented minor
	// limitation: in a re-converging multi-root DAG the chosen root is the
	// shortest-path-deepest one, tie-broken by id — a valid root, not guaranteed
	// the single most-ancestral.)
	const hopInto = new Map<string, AncestryHop>(); // causeId → edge that reached it (set once)
	const depth = new Map<string, number>([[sourceEvent.id, 0]]);
	const visited = new Set<string>([sourceEvent.id]);
	// Nodes with ≥1 admissible (owned + revealed) outgoing cause. A visited node
	// NOT in this set is a true ROOT — a cause with no further recorded cause.
	const hasAdmissibleCause = new Set<string>();

	const queue: string[] = [sourceEvent.id];
	while (queue.length > 0) {
		const node = queue.shift()!;
		const causes = await db
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
					// Scope BOTH the relationship row AND the cause entity to the
					// caller. Without the relationship predicate an imported / null-user
					// edge referencing one of the caller's Events would leak its id +
					// start_position into the chain — the rest of the app
					// (/api/relationships, the store) uses this owned-edge set too
					// (Codex review #66).
					eq(relationships.userId, userId),
					eq(entities.userId, userId) // cross-user ancestor → excluded → walk stops
				)
			);

		for (const c of causes) {
			// Reveal gate: a not-yet-revealed link is invisible to the reader at T.
			if (c.revealedAtPosition != null && t < c.revealedAtPosition) continue;
			hasAdmissibleCause.add(node); // node has a real upstream cause → not a root
			if (visited.has(c.causeId)) continue; // cycle / re-converging DAG guard
			visited.add(c.causeId);
			hopInto.set(c.causeId, {
				fromId: node,
				relationshipId: c.relationshipId,
				startPosition: c.startPosition,
				name: c.causeName
			});
			depth.set(c.causeId, (depth.get(node) ?? 0) + 1);
			queue.push(c.causeId);
		}
	}

	// Earliest cause = the deepest ROOT (no admissible outgoing cause), tie-broken
	// by lowest id. If every reachable node has an outgoing cause (a pure cycle —
	// a data error, caused_by isn't cycle-checked at write), fall back to the
	// deepest visited node so the walk still returns a defined answer.
	const roots = [...visited].filter((id) => !hasAdmissibleCause.has(id));
	const candidates = roots.length > 0 ? roots : [...visited];
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
