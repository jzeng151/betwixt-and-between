import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { windowCanvasState } from '$lib/server/db/schema.js';
import type { RequestHandler } from './$types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Atomic multi-row upsert for one window. Wrapped in a single transaction so
 * partial failure (e.g. one row violates the entity FK) rolls all rows back.
 * This is the C5 dagre-layout atomicity guarantee from the locked Lane A plan.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const { windowId } = params;
	if (!windowId) error(400, 'windowId is required');

	const body = await request.json().catch(() => null);
	if (!Array.isArray(body)) error(400, 'body must be an array');

	const rows = body.map((raw, i) => {
		if (!raw || typeof raw !== 'object') error(400, `row ${i}: must be an object`);
		const { entityId, x, y, width, height, pinned } = raw as Record<string, unknown>;
		if (typeof entityId !== 'string' || !UUID_RE.test(entityId))
			error(400, `row ${i}: entityId must be a uuid`);
		if (typeof x !== 'number' || typeof y !== 'number')
			error(400, `row ${i}: x and y must be numbers`);
		return {
			windowId,
			entityId,
			x: Math.trunc(x),
			y: Math.trunc(y),
			width: typeof width === 'number' ? Math.trunc(width) : 160,
			height: typeof height === 'number' ? Math.trunc(height) : 80,
			pinned: typeof pinned === 'number' ? (pinned ? 1 : 0) : 0
		};
	});

	if (rows.length === 0) return json([]);

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
