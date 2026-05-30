import { json, error } from '@sveltejs/kit';
import { entities } from '$lib/server/db/schema.js';
import { EntityType } from '$lib/server/db/schema.js';
import { getUserId, assertParentOwned } from '$lib/server/auth-gate.js';
import { validateStyleInData } from '$lib/server/style-validation.js';
import {
	recomputeAllIntervals,
	recomputeIntervalsForAct,
	snapshotActOrdering
} from '$lib/server/intervals.js';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const rows = await db
		.select()
		.from(entities)
		.where(eq(entities.userId, userId))
		.orderBy(desc(entities.createdAt));
	return json(rows);
};

/**
 * Create an entity. For Acts inserted with a position less than the current
 * act count, sibling acts at position >= N are bumped by +1 (insert-between
 * cascade per D1/Issue 1A) and intervals are recomputed.
 *
 * For Scenes added to an Act, recomputes interval positions for the parent
 * act (m changed → scene-anchored intervals shift).
 */
export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const body = await event.request.json();
	const { type, name, data, parentId, position } = body;

	// Slice 3 T24 — validate data.style on create.
	validateStyleInData(data, 'entity.data');

	if (!type || !EntityType.includes(type)) {
		error(400, 'Invalid entity type');
	}
	if (!name || typeof name !== 'string' || name.trim() === '') {
		error(400, 'Name is required');
	}

	if (typeof parentId === 'string') {
		await assertParentOwned(db, userId, parentId);
	}

	// Insert-between cascade for Acts wrapped in a transaction so the sibling
	// bump + insert + recompute are atomic. preSnapshot is captured BEFORE the
	// sibling-position UPDATE so map_anchors / map_events can reproject from
	// pre-insert Act indices (Codex P1 on PR #52 commit a9c550f, line 433:
	// insert-between shifts indices identically to a reorder, but the
	// pre-fix POST handler called recomputeAllIntervals WITHOUT a snapshot —
	// anchors/events were silently skipped while intervals were rewritten).
	// userId in WHERE: critical for multi-tenant isolation.
	let created: typeof entities.$inferSelect;
	try {
		created = await db.transaction(async (tx) => {
			let didActInsertBetween = false;
			let preSnapshot: Awaited<ReturnType<typeof snapshotActOrdering>> | undefined;

			if (type === 'Act' && parentId == null && typeof position === 'number') {
				const existingAtOrAfter = await tx
					.select({ id: entities.id })
					.from(entities)
					.where(
						and(
							eq(entities.userId, userId),
							eq(entities.type, 'Act'),
							isNull(entities.parentId),
							sql`${entities.position} >= ${position}`
						)
					);
				if (existingAtOrAfter.length > 0) {
					didActInsertBetween = true;
					preSnapshot = await snapshotActOrdering(tx, userId);
					await tx
						.update(entities)
						.set({
							position: sql`${entities.position} + 1` as unknown as number
						})
						.where(
							and(
								eq(entities.userId, userId),
								eq(entities.type, 'Act'),
								isNull(entities.parentId),
								sql`${entities.position} >= ${position}`
							)
						);
				}
			}

			const [row] = await tx
				.insert(entities)
				.values({
					userId,
					type,
					name: name.trim(),
					data: (data ?? {}) as Record<string, unknown>,
					parentId: typeof parentId === 'string' ? parentId : null,
					position: typeof position === 'number' ? position : null
				})
				.returning();

			if (type === 'Scene' && row.parentId) {
				await recomputeIntervalsForAct(tx, row.parentId, userId);
			}
			if (didActInsertBetween) {
				await recomputeAllIntervals(tx, userId, preSnapshot);
			}

			return row;
		});
	} catch (err) {
		error(400, (err as Error).message);
	}

	return json(created, { status: 201 });
};
