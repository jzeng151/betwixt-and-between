import { json, error } from '@sveltejs/kit';
import { entities, windowCanvasState } from '$lib/server/db/schema.js';
import { and, eq, inArray } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import { isUuid, coercePinned } from '$lib/server/validation.js';
import type { RequestHandler } from './$types';

/**
 * Atomic multi-row upsert for one window. Wrapped in a single transaction so
 * partial failure (e.g. one row violates the entity FK) rolls all rows back.
 * This is the C5 dagre-layout atomicity guarantee from the locked Lane A plan.
 */
export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const { windowId } = event.params;
	if (!windowId) error(400, 'windowId is required');

	const body = await event.request.json().catch(() => null);
	if (!Array.isArray(body)) error(400, 'body must be an array');

	const rows = body.map((raw, i) => {
		if (!raw || typeof raw !== 'object') error(400, `row ${i}: must be an object`);
		const { entityId, x, y, width, height, pinned } = raw as Record<string, unknown>;
		if (!isUuid(entityId)) error(400, `row ${i}: entityId must be a uuid`);
		if (typeof x !== 'number' || typeof y !== 'number')
			error(400, `row ${i}: x and y must be numbers`);
		return {
			windowId,
			userId,
			entityId: entityId as string,
			x: Math.trunc(x),
			y: Math.trunc(y),
			width: typeof width === 'number' ? Math.trunc(width) : 160,
			height: typeof height === 'number' ? Math.trunc(height) : 80,
			pinned: coercePinned(pinned)
		};
	});

	if (rows.length === 0) return json([]);

	// Verify every entity belongs to the user before any write — fail fast.
	const entityIds = rows.map((r) => r.entityId);
	const owned = await db
		.select({ id: entities.id })
		.from(entities)
		.where(and(inArray(entities.id, entityIds), eq(entities.userId, userId)));
	if (owned.length !== new Set(entityIds).size) {
		error(400, 'one or more entityIds not found');
	}

	const upserted = await db.transaction(async (tx) => {
		const out = [];
		for (const row of rows) {
			const [r] = await tx
				.insert(windowCanvasState)
				.values(row)
				.onConflictDoUpdate({
					target: [windowCanvasState.windowId, windowCanvasState.entityId],
					set: { x: row.x, y: row.y, width: row.width, height: row.height, pinned: row.pinned }
				})
				.returning();
			out.push(r);
		}
		return out;
	});

	return json(upserted);
};
