import { json, error } from '@sveltejs/kit';
import { entities, mapAnchors, worldMaps } from '$lib/server/db/schema.js';
import { getUserId } from '$lib/server/auth-gate.js';
import {
	recomputeAllIntervals,
	recomputeIntervalsForAct,
	snapshotActOrdering
} from '$lib/server/intervals.js';
import { intervals as intervalsTable, relationships as relationshipsTable } from '$lib/server/db/schema.js';
import { and, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { readJson } from '$lib/server/read-json.js';
import { isUniqueViolation } from '$lib/server/pg-errors.js';
import { validateStyleInData } from '$lib/server/style-validation.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const [entity] = await db
		.select()
		.from(entities)
		.where(and(eq(entities.id, event.params.id), eq(entities.userId, userId)));
	if (!entity) error(404, 'Entity not found');
	return json(entity);
};

/**
 * Patch an entity. Accepts `name`, `data`, `parentId`, `position`.
 * For Acts/Scenes, position changes cascade siblings server-side
 * (locked D18/Issue 12A) and recompute intervals. parentId changes for
 * Scenes trigger a cross-act move via the moveSceneToAct primitive
 * (recompute both old and new parent acts).
 */
export const PATCH: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const body = await readJson(event);
	const { name, data, parentId, position } = body as {
		name?: string;
		data?: unknown;
		parentId?: string | null;
		position?: number;
	};

	// Validate scalar inputs before touching anything: a non-string name used
	// to reach name.trim() (TypeError → 500), and a float/NaN position reaches
	// an integer column + the sibling-bump math.
	if (name !== undefined && (typeof name !== 'string' || name.trim() === '')) {
		error(400, 'name must be a non-empty string');
	}
	if (position !== undefined && position !== null && !Number.isInteger(position)) {
		error(400, 'position must be an integer');
	}

	const [entity] = await db
		.select()
		.from(entities)
		.where(and(eq(entities.id, event.params.id), eq(entities.userId, userId)));
	if (!entity) error(404, 'Entity not found');

	// updated_at is maintained by the bump_updated_at BEFORE UPDATE trigger
	// — do not set it here. data is jsonb on pg; pass the object directly.
	const updates: Record<string, unknown> = {};
	if (name !== undefined) updates.name = name.trim();
	if (data !== undefined) {
		// Slice 3 T24 — validate data.style against the cascade whitelist.
		// data itself stays free-form (per-entity-type field schema varies);
		// the style sub-key is the closed-enum part the renderer trusts.
		validateStyleInData(data, 'entity.data');
		updates.data = data;
	}

	// parentId change for Scenes: delegate to moveSceneToAct. Wrap the whole
	// "structural change + recompute cascade" in a single transaction per the
	// WM3 design doc atomicity requirement: partial-failure mid-cascade must
	// leave intervals + relationships + variants + placements + anchors +
	// events ALL in pre-state OR ALL in post-state.
	if (parentId !== undefined && parentId !== entity.parentId) {
		if (entity.type !== 'Scene') {
			error(400, 'parentId can only be changed for Scene entities');
		}
		const { moveSceneToAct } = await import('$lib/server/intervals.js');
		const newPos = typeof position === 'number' ? position : 0;
		const refreshed = await db.transaction(async (tx) => {
			await moveSceneToAct(tx, event.params.id, parentId as string, newPos, userId);
			if (name !== undefined || data !== undefined) {
				await tx
					.update(entities)
					.set(updates)
					.where(and(eq(entities.id, event.params.id), eq(entities.userId, userId)));
			}
			const [row] = await tx
				.select()
				.from(entities)
				.where(and(eq(entities.id, event.params.id), eq(entities.userId, userId)));
			return row;
		}).catch((err) => {
			if ((err as { status?: number }).status) throw err;
			if (isUniqueViolation(err)) {
				error(409, 'The move collides with an existing row (duplicate temporal bounds)');
			}
			// Re-throw unmatched errors (opaque 500) instead of echoing the raw
			// driver/cascade message — parity with the reorder/delete catches below.
			throw err;
		});
		return json(refreshed);
	}

	// Position change — cascade siblings if same parent context (D18/12A).
	// userId in WHERE: critical — User A's reorder must not bump User B's
	// siblings (especially for Acts where parentId is null).
	//
	// Whole block runs inside db.transaction for cascade atomicity (WM3 design
	// doc: intervals + relationships + variants + placements + anchors +
	// events all-or-nothing). For Act reorders, the Act-ordering snapshot is
	// captured INSIDE the tx — same transactional view as the subsequent
	// entities.position UPDATE — so map_anchors / map_events can reproject
	// their t_position from the pre-reorder Act indices (CMT-7 option A).
	const willPositionCascade =
		position !== undefined &&
		position !== entity.position &&
		(entity.type === 'Act' || entity.type === 'Scene');

	// 23505 → 409 (2026-06 audit): the recompute cascade inside this tx can
	// collide with relationships_temporal_dedup (a derived position landing on
	// an unchanged row's tuple). Parity with the relationships/maps routes.
	const updated = await db.transaction(async (tx) => {
		let preSnapshot: Awaited<ReturnType<typeof snapshotActOrdering>> | undefined;

		if (willPositionCascade && entity.type === 'Act') {
			preSnapshot = await snapshotActOrdering(tx, userId);
		}

		if (willPositionCascade) {
			const oldPos = entity.position;
			const siblingFilter =
				entity.type === 'Act'
					? and(eq(entities.userId, userId), eq(entities.type, 'Act'), isNull(entities.parentId))
					: and(eq(entities.userId, userId), eq(entities.type, 'Scene'), eq(entities.parentId, entity.parentId!));

			if (oldPos === null) {
				// Position was null — treat as appending at the end. Just set it.
			} else if (position! < oldPos) {
				await tx
					.update(entities)
					.set({ position: sql`${entities.position} + 1` as unknown as number })
					.where(
						and(
							siblingFilter,
							ne(entities.id, event.params.id),
							gte(entities.position, position!),
							lt(entities.position, oldPos)
						)
					);
			} else {
				await tx
					.update(entities)
					.set({ position: sql`${entities.position} - 1` as unknown as number })
					.where(
						and(
							siblingFilter,
							ne(entities.id, event.params.id),
							gt(entities.position, oldPos),
							lte(entities.position, position!)
						)
					);
			}
			updates.position = position!;
		} else if (position !== undefined) {
			updates.position = position;
		}

		const [row] = await tx
			.update(entities)
			.set(updates)
			.where(and(eq(entities.id, event.params.id), eq(entities.userId, userId)))
			.returning();

		if (willPositionCascade) {
			if (entity.type === 'Act') {
				await recomputeAllIntervals(tx, userId, preSnapshot);
			} else if (entity.type === 'Scene' && entity.parentId) {
				await recomputeIntervalsForAct(tx, entity.parentId, userId);
			}
		}

		return row;
	}).catch((err) => {
		if ((err as { status?: number }).status) throw err;
		if (isUniqueViolation(err)) {
			error(409, 'The reorder collides with an existing row (duplicate temporal bounds)');
		}
		throw err;
	});

	return json(updated);
};

/**
 * Delete an entity. For Acts, optionally accepts ?moveScenesTo=<actId>
 * to reparent the act's scenes to another act before cascade-deleting
 * (D9/7B). Without the param, scenes cascade-delete via FK. Either way,
 * surviving intervals are recomputed.
 *
 * P2-3 fix: when reparenting, intervals' start_act_id / end_act_id are
 * updated for any interval anchored to a reparented scene.
 */
export const DELETE: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const [entity] = await db
		.select()
		.from(entities)
		.where(and(eq(entities.id, event.params.id), eq(entities.userId, userId)));
	if (!entity) error(404, 'Entity not found');

	const moveScenesTo = event.url.searchParams.get('moveScenesTo');

	// Pre-tx validation of the moveScenesTo target so 400 surfaces before any
	// mutation. Reads only — safe outside the transaction.
	if (moveScenesTo && entity.type === 'Act') {
		if (moveScenesTo === event.params.id) {
			error(400, 'moveScenesTo target must differ from the act being deleted');
		}
		const [target] = await db
			.select()
			.from(entities)
			.where(and(eq(entities.id, moveScenesTo), eq(entities.userId, userId)));
		if (!target) {
			error(400, `moveScenesTo target not found: ${moveScenesTo}`);
		}
		if (target.type !== 'Act') {
			error(400, `moveScenesTo target must be an Act (got type='${target.type}')`);
		}
	}

	// Wrap rescope + delete + recompute in a single transaction (WM3 design
	// doc atomicity requirement). For Act deletes, capture the Act-ordering
	// snapshot inside the tx BEFORE the entity row is removed so map_anchors
	// / map_events can reproject their t_position from pre-delete indices
	// (CMT-7 option A; anchors at floor(t_position) == deletedIdx are left
	// unchanged — semantic drift accepted, U12 revisit in Slice 2).
	await db.transaction(async (tx) => {
		const preSnapshot =
			entity.type === 'Act' ? await snapshotActOrdering(tx, userId) : undefined;

		// Ids of scenes reparented to moveScenesTo (consumed by the rescope
		// block below — an interval side anchored to one of these scenes now
		// lives in the TARGET act, so the other side should follow it there
		// rather than rescope to prev/next).
		const movedSceneIds = new Set<string>();

		if (moveScenesTo && entity.type === 'Act') {
			// Count target's existing scenes to compute append offset.
			const sourceScenes = await tx
				.select()
				.from(entities)
				.where(and(eq(entities.userId, userId), eq(entities.type, 'Scene'), eq(entities.parentId, event.params.id)))
				.orderBy(entities.position, entities.createdAt);
			const targetScenes = await tx
				.select({ id: entities.id })
				.from(entities)
				.where(and(eq(entities.userId, userId), eq(entities.type, 'Scene'), eq(entities.parentId, moveScenesTo)));
			const offset = targetScenes.length;

			// Reparent each scene (per-row: each gets a distinct position).
			for (let i = 0; i < sourceScenes.length; i++) {
				const scene = sourceScenes[i];
				movedSceneIds.add(scene.id);
				await tx
					.update(entities)
					.set({ parentId: moveScenesTo, position: offset + i })
					.where(and(eq(entities.id, scene.id), eq(entities.userId, userId)));
			}

			// Re-anchor interval + relationship act FKs for the moved scenes
			// (P2-3; relationships per Slice 5 PR-D / Codex P2 — without this
			// the act FK would hit ON DELETE SET NULL below, dropping the row
			// out of recomputeRelationshipBoundsAll and freezing a stale scoped
			// position). Batched per table (2026-06 perf audit): one UPDATE per
			// FK column instead of four sequential statements per scene.
			if (movedSceneIds.size > 0) {
				const sceneIds = [...movedSceneIds];
				await tx
					.update(intervalsTable)
					.set({ startActId: moveScenesTo })
					.where(and(inArray(intervalsTable.startSceneId, sceneIds), eq(intervalsTable.userId, userId)));
				await tx
					.update(intervalsTable)
					.set({ endActId: moveScenesTo })
					.where(and(inArray(intervalsTable.endSceneId, sceneIds), eq(intervalsTable.userId, userId)));
				await tx
					.update(relationshipsTable)
					.set({ startActId: moveScenesTo })
					.where(and(inArray(relationshipsTable.startSceneId, sceneIds), eq(relationshipsTable.userId, userId)));
				await tx
					.update(relationshipsTable)
					.set({ endActId: moveScenesTo })
					.where(and(inArray(relationshipsTable.endSceneId, sceneIds), eq(relationshipsTable.userId, userId)));
			}
		}

		// Pre-rescope intervals touching this act before the cascade deletes them.
		// FK is onDelete: 'cascade', so any interval with startActId or endActId
		// pointing here would otherwise be removed entirely. Instead, reassign
		// the boundary to the adjacent surviving act so the character/event
		// scope shrinks rather than disappearing. Intervals fully contained in
		// this act (both ends here) cannot be salvaged and still get deleted.
		if (entity.type === 'Act') {
			const allActs = await tx
				.select({ id: entities.id, position: entities.position, createdAt: entities.createdAt })
				.from(entities)
				.where(and(eq(entities.userId, userId), eq(entities.type, 'Act'), isNull(entities.parentId)))
				.orderBy(entities.position, entities.createdAt);
			const deletedIdx = allActs.findIndex((a) => a.id === event.params.id);
			if (deletedIdx >= 0 && allActs.length > 1) {
				const prevAct = deletedIdx > 0 ? allActs[deletedIdx - 1] : null;
				const nextAct = deletedIdx < allActs.length - 1 ? allActs[deletedIdx + 1] : null;

				const touched = await tx
					.select()
					.from(intervalsTable)
					.where(
						and(
							eq(intervalsTable.userId, userId),
							or(
								eq(intervalsTable.startActId, event.params.id),
								eq(intervalsTable.endActId, event.params.id)
							)
						)
					);

				// Post-delete ordered index of the moveScenesTo target (when in
				// play): pre-delete indices above the deleted slot shift down 1.
				const targetPreIdx = moveScenesTo
					? allActs.findIndex((a) => a.id === moveScenesTo)
					: -1;
				const targetPostIdx =
					targetPreIdx >= 0 ? (targetPreIdx > deletedIdx ? targetPreIdx - 1 : targetPreIdx) : -1;

				for (const iv of touched) {
					const startInDeleted = iv.startActId === event.params.id;
					const endInDeleted = iv.endActId === event.params.id;

					// Both endpoints in the deleted act → no salvageable scope.
					if (startInDeleted && endInDeleted) {
						await tx
							.delete(intervalsTable)
							.where(and(eq(intervalsTable.id, iv.id), eq(intervalsTable.userId, userId)));
						continue;
					}

					if (endInDeleted) {
						// 2026-06 audit fix: when the interval's START side is anchored
						// to a scene that just moved to moveScenesTo, "end of the
						// deleted act" must follow the scenes to "end of the target
						// act". Rescoping to prevAct would invert the interval (the
						// scene side now derives inside the target act, at-or-after
						// the prevAct boundary) and 500 the whole DELETE.
						if (iv.startSceneId && movedSceneIds.has(iv.startSceneId) && targetPostIdx >= 0) {
							// movedSceneIds is only populated when moveScenesTo is set.
							await tx
								.update(intervalsTable)
								.set({
									endActId: moveScenesTo!,
									endSceneId: null,
									endPosition: targetPostIdx + 1
								})
								.where(and(eq(intervalsTable.id, iv.id), eq(intervalsTable.userId, userId)));
						} else if (!prevAct) {
							await tx
								.delete(intervalsTable)
								.where(and(eq(intervalsTable.id, iv.id), eq(intervalsTable.userId, userId)));
							continue;
						} else {
							/* See full comment in pre-tx version: ordered-list index, not stored
							   position; prevAct's pre-delete index = deletedIdx-1 = post-delete
							   index; end-of-prevAct = idx + 1. */
							const newEndPos = deletedIdx;
							await tx
								.update(intervalsTable)
								.set({
									endActId: prevAct.id,
									endSceneId: null,
									endPosition: newEndPos
								})
								.where(and(eq(intervalsTable.id, iv.id), eq(intervalsTable.userId, userId)));
						}
					}

					if (startInDeleted) {
						// Mirror of the endInDeleted case: an END side anchored to a
						// moved scene pulls the start boundary to the target act.
						if (iv.endSceneId && movedSceneIds.has(iv.endSceneId) && targetPostIdx >= 0) {
							// movedSceneIds is only populated when moveScenesTo is set.
							await tx
								.update(intervalsTable)
								.set({
									startActId: moveScenesTo!,
									startSceneId: null,
									startPosition: targetPostIdx
								})
								.where(and(eq(intervalsTable.id, iv.id), eq(intervalsTable.userId, userId)));
						} else if (!nextAct) {
							await tx
								.delete(intervalsTable)
								.where(and(eq(intervalsTable.id, iv.id), eq(intervalsTable.userId, userId)));
							continue;
						} else {
							/* nextAct's pre-delete index = deletedIdx+1; post-delete it shifts down
							   to deletedIdx. Using the post-delete index means recomputeAllIntervals
							   finds no drift to correct. */
							const newStartPos = deletedIdx;
							await tx
								.update(intervalsTable)
								.set({
									startActId: nextAct.id,
									startSceneId: null,
									startPosition: newStartPos
								})
								.where(and(eq(intervalsTable.id, iv.id), eq(intervalsTable.userId, userId)));
						}
					}
				}
			}
		}

		// Slice 2 D2 PR-C hardening (codex review): for Location deletes,
		// scrub the deleted locationId out of every anchor's
		// state_jsonb.regions[]. Pre-T6 the DB-level
		// `map_regions.location_id ON DELETE SET NULL` handled this. Post-
		// T6 anchor JSON is a free-form string blob with no FK; deleting
		// a Location without this scrub leaves stale ids in canonical
		// state. Scoped via world_maps.user_id so a cross-user run of
		// this helper can't touch foreign data.
		if (entity.type === 'Location') {
			// codex PR review iter 9: region writes now store the DB-canonical
			// lowercase loc.id in anchor JSON (iter-4 fix). If the DELETE
			// route param is uppercase, PG's uuid type accepts it for the
			// entity lookup but string-equality against the lowercase JSON
			// value misses. Use the SELECTed entity.id (PG-canonical) so the
			// scrub matches the writer's canonicalization.
			const canonicalId = entity.id;
			await tx.execute(sql`
				UPDATE ${mapAnchors}
				SET state_jsonb = jsonb_set(
					state_jsonb,
					'{regions}',
					COALESCE(
						(
							SELECT jsonb_agg(
								CASE
									WHEN r->>'locationId' = ${canonicalId}
										THEN jsonb_set(r, '{locationId}', 'null'::jsonb)
									ELSE r
								END
							)
							FROM jsonb_array_elements(COALESCE(state_jsonb->'regions', '[]'::jsonb)) AS r
						),
						'[]'::jsonb
					),
					true
				)
				FROM ${worldMaps}
				WHERE ${mapAnchors.worldMapId} = ${worldMaps.id}
					AND ${worldMaps.userId} = ${userId}
					AND state_jsonb->'regions' @> ${`[{"locationId":"${canonicalId}"}]`}::jsonb
			`);
		}

		// FK CASCADE removes remaining scenes and any fully-contained intervals already deleted above.
		await tx
			.delete(entities)
			.where(and(eq(entities.id, event.params.id), eq(entities.userId, userId)));

		// Recompute survivors. Act delete shifts every act's index; recompute all.
		if (entity.type === 'Act') {
			await recomputeAllIntervals(tx, userId, preSnapshot);
		} else if (entity.type === 'Scene' && entity.parentId) {
			await recomputeIntervalsForAct(tx, entity.parentId, userId);
		}
	}).catch((err) => {
		if ((err as { status?: number }).status) throw err;
		if (isUniqueViolation(err)) {
			error(409, 'The delete collides with an existing row (duplicate temporal bounds)');
		}
		throw err;
	});

	return new Response(null, { status: 204 });
};
