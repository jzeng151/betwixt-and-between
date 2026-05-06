import { json, error } from '@sveltejs/kit';
import { withDb } from '$lib/server/db/index.js';
import { windowCanvasState } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { isUuid, coercePinned } from '$lib/server/validation.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, params }) =>
	withDb(platform?.env, async (db) => {
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

	});

export const PUT: RequestHandler = async ({ platform, params, request }) =>
	withDb(platform?.env, async (db) => {
	const { windowId } = params;
	if (!windowId) error(400, 'windowId is required');

	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') error(400, 'malformed body');

	const { entityId, x, y, width, height, pinned } = body as Record<string, unknown>;

	if (!isUuid(entityId)) error(400, 'entityId must be a uuid');
	if (typeof x !== 'number' || typeof y !== 'number') error(400, 'x and y must be numbers');

	const row = {
		windowId,
		entityId,
		x: Math.trunc(x),
		y: Math.trunc(y),
		width: typeof width === 'number' ? Math.trunc(width) : 160,
		height: typeof height === 'number' ? Math.trunc(height) : 80,
		pinned: coercePinned(pinned)
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

	});

export const DELETE: RequestHandler = async ({ platform, params }) =>
	withDb(platform?.env, async (db) => {
	const { windowId } = params;
	if (!windowId) error(400, 'windowId is required');

	await db.delete(windowCanvasState).where(eq(windowCanvasState.windowId, windowId));
	return json({ ok: true });

	});
