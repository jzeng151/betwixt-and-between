import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { windowCanvasState } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

// UUID v1-v5 (any version) regex. entities.id is uuid in pg; an invalid
// string would FK-fail with a confusing "invalid input syntax for type uuid"
// error from pg. Pre-validate so callers get a clean 400 instead.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async ({ params }) => {
	const { windowId } = params;
	if (!windowId) error(400, 'windowId is required');

	const rows = await db
		.select({
			entityId: windowCanvasState.entityId,
			x: windowCanvasState.x,
			y: windowCanvasState.y,
			width: windowCanvasState.width,
			height: windowCanvasState.height,
			pinned: windowCanvasState.pinned
		})
		.from(windowCanvasState)
		.where(eq(windowCanvasState.windowId, windowId));

	return json(rows);
};

export const PUT: RequestHandler = async ({ params, request }) => {
	const { windowId } = params;
	if (!windowId) error(400, 'windowId is required');

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') error(400, 'malformed body');

	const { entityId, x, y, width, height, pinned } = body as Record<string, unknown>;

	if (typeof entityId !== 'string' || !UUID_RE.test(entityId))
		error(400, 'entityId must be a uuid');
	if (typeof x !== 'number' || typeof y !== 'number') error(400, 'x and y must be numbers');

	const row = {
		windowId,
		entityId,
		x: Math.trunc(x),
		y: Math.trunc(y),
		width: typeof width === 'number' ? Math.trunc(width) : 160,
		height: typeof height === 'number' ? Math.trunc(height) : 80,
		pinned: typeof pinned === 'number' ? (pinned ? 1 : 0) : 0
	};

	const [upserted] = await db
		.insert(windowCanvasState)
		.values(row)
		.onConflictDoUpdate({
			target: [windowCanvasState.windowId, windowCanvasState.entityId],
			set: { x: row.x, y: row.y, width: row.width, height: row.height, pinned: row.pinned }
		})
		.returning();

	return json(upserted);
};

export const DELETE: RequestHandler = async ({ params }) => {
	const { windowId } = params;
	if (!windowId) error(400, 'windowId is required');

	await db.delete(windowCanvasState).where(eq(windowCanvasState.windowId, windowId));
	return json({ ok: true });
};
