import { json, error } from '@sveltejs/kit';
import { entities } from '$lib/server/db/schema.js';
import { EntityType } from '$lib/server/db/schema.js';
import { getUserId } from '$lib/server/auth-gate.js';
import { recomputeIntervalsForAct } from '$lib/server/intervals.js';
import type { RequestHandler } from './$types';

/**
 * Atomic multi-entity creation. Locked in /plan-eng-review D21/Issue 20A.
 *
 * Body: `{ entities: [{ type, name, parentId?, position?, data? }, ...] }`
 *
 * Validates every payload first; if any is malformed, returns 400 without
 * inserting any rows. Then inserts all rows; on FK violation, surfaces 400.
 *
 * Recomputes interval positions ONCE per affected parent Act (deduped) so
 * break-into-scenes with N scenes triggers one recompute, not N.
 */
export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const body = await event.request.json();
	const items = body?.entities;
	if (!Array.isArray(items)) {
		error(400, 'Body must contain an `entities` array');
	}

	// Validate everything before touching the DB.
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		if (!item || typeof item !== 'object') {
			error(400, `entities[${i}] is not an object`);
		}
		if (!item.type || !EntityType.includes(item.type)) {
			error(400, `entities[${i}].type is invalid`);
		}
		if (!item.name || typeof item.name !== 'string' || item.name.trim() === '') {
			error(400, `entities[${i}].name is required`);
		}
	}

	if (items.length === 0) return json([], { status: 201 });

	// Insert each row; track the affected parent acts for deduped recompute.
	const created: (typeof entities.$inferSelect)[] = [];
	const affectedParentActs = new Set<string>();
	try {
		for (const item of items) {
			const [row] = await db
				.insert(entities)
				.values({
					userId,
					type: item.type,
					name: item.name.trim(),
					data: (item.data ?? {}) as Record<string, unknown>,
					parentId: typeof item.parentId === 'string' ? item.parentId : null,
					position: typeof item.position === 'number' ? item.position : null
				})
				.returning();
			created.push(row);
			if (row.type === 'Scene' && row.parentId) {
				affectedParentActs.add(row.parentId);
			}
		}
	} catch (err) {
		// FK violation, etc. — caller should treat the batch as failed.
		error(400, (err as Error).message);
	}

	// Deduped recompute (one call per affected parent act).
	for (const actId of affectedParentActs) {
		await recomputeIntervalsForAct(db, actId, userId);
	}

	return json(created, { status: 201 });
};
