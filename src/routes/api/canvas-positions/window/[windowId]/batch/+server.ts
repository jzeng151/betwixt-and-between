import { json, error } from '@sveltejs/kit';
import { entities, windowCanvasState } from '$lib/server/db/schema.js';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import { isUuid, coercePinned } from '$lib/server/validation.js';
import type { RequestHandler } from './$types';

// ≈8 bind params per row × 2000 = 16000, comfortably under Postgres's 65535
// statement-parameter ceiling; far above any realistic node count in one window.
const MAX_CANVAS_BATCH = 2000;

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
	// Bound the batch so the single multi-row upsert (≈8 bind params/row) and the
	// ownership IN(...) below can't exceed Postgres's 65535-parameter statement
	// limit (2026-06 audit follow-up). A window never holds this many nodes; an
	// oversized batch is a bug or abuse, so reject rather than chunk (chunking
	// would break the single-statement atomicity this route relies on).
	if (body.length > MAX_CANVAS_BATCH) {
		error(400, `batch too large: ${body.length} rows (max ${MAX_CANVAS_BATCH})`);
	}

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

	// Single multi-row INSERT … ON CONFLICT (2026-06 perf audit): the previous
	// per-row loop issued one round trip per node — a dagre auto-layout of a
	// few hundred entities paid hundreds of sequential statements. One
	// statement is also inherently atomic, so the explicit transaction goes.
	// Postgres forbids the same conflict target twice in one statement, so
	// duplicate entityIds within the batch are deduped last-wins (matching the
	// old loop's effective behavior).
	const byEntity = new Map(rows.map((r) => [r.entityId, r]));
	const upserted = await db
		.insert(windowCanvasState)
		.values([...byEntity.values()])
		.onConflictDoUpdate({
			target: [windowCanvasState.windowId, windowCanvasState.entityId],
			set: {
				x: sql`excluded.x`,
				y: sql`excluded.y`,
				width: sql`excluded.width`,
				height: sql`excluded.height`,
				pinned: sql`excluded.pinned`
			}
		})
		.returning();

	return json(upserted);
};
