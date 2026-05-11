import { json, error } from '@sveltejs/kit';
import { entities } from '$lib/server/db/schema.js';
import { EntityType } from '$lib/server/db/schema.js';
import { getUserId, assertParentOwned } from '$lib/server/auth-gate.js';
import { recomputeAllIntervals, recomputeIntervalsForAct } from '$lib/server/intervals.js';
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

	if (!type || !EntityType.includes(type)) {
		error(400, 'Invalid entity type');
	}
	if (!name || typeof name !== 'string' || name.trim() === '') {
		error(400, 'Name is required');
	}

	if (typeof parentId === 'string') {
		await assertParentOwned(db, userId, parentId);
	}

	// Insert-between cascade for Acts: if a position is given and there's
	// already an act at that position (or beyond), bump siblings to make room.
	// Locked 2026-04-29 in /plan-eng-review (D1/Issue 1A). The cascade runs
	// before the insert; the recompute runs after.
	// userId in WHERE: critical for multi-tenant isolation — User A's reorder
	// must not bump User B's acts.
	let didActInsertBetween = false;
	if (type === 'Act' && parentId == null && typeof position === 'number') {
		const existingAtOrAfter = await db
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
			await db
				.update(entities)
				.set({
					position: sql`${entities.position} + 1` as unknown as number,
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

	let created;
	try {
		[created] = await db
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
	} catch (err) {
		// FK violation on parentId, etc. — surface as 400.
		error(400, (err as Error).message);
	}

	// When a Scene is added to an Act, recompute that act's intervals.
	if (type === 'Scene' && created.parentId) {
		await recomputeIntervalsForAct(db, created.parentId, userId);
	}
	// When an Act is inserted between existing acts, every interval needs
	// its position re-derived because act_index shifted for some acts.
	if (didActInsertBetween) {
		await recomputeAllIntervals(db, userId);
	}

	return json(created, { status: 201 });
};
