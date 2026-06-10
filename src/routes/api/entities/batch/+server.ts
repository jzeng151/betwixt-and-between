import { json, error } from '@sveltejs/kit';
import { entities } from '$lib/server/db/schema.js';
import { EntityType } from '$lib/server/db/schema.js';
import { getUserId, assertParentsOwned } from '$lib/server/auth-gate.js';
import { readJson } from '$lib/server/read-json.js';
import { recomputeIntervalsForAct } from '$lib/server/intervals.js';
import { validateStyleInData } from '$lib/server/style-validation.js';
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
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const body = (await readJson(event)) as any;
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
		// codex P2: batch is also an entity-create path — apply the same style
		// whitelist as POST /api/entities so a batch payload can't persist an
		// invalid/oversized data.style that the placement cascade later consumes.
		validateStyleInData(item.data, `entities[${i}].data`);
	}

	if (items.length === 0) return json([], { status: 201 });

	const parentIds = Array.from(
		new Set(
			items
				.map((item: { parentId?: unknown }) => item.parentId)
				.filter((p: unknown): p is string => typeof p === 'string')
		)
	);
	await assertParentsOwned(db, userId, parentIds);

	// Insert + recompute in a single transaction (WM3 design doc atomicity).
	// A mid-batch FK violation must leave NO partial inserts behind. No
	// preSnapshot needed — recomputeIntervalsForAct is per-Act and does not
	// shift any Act index, so map_anchors / map_events t_positions are
	// unaffected.
	let created: (typeof entities.$inferSelect)[] = [];
	try {
		created = await db.transaction(async (tx) => {
			const rows: (typeof entities.$inferSelect)[] = [];
			const affectedParentActs = new Set<string>();
			for (const item of items) {
				const [row] = await tx
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
				rows.push(row);
				if (row.type === 'Scene' && row.parentId) {
					affectedParentActs.add(row.parentId);
				}
			}
			for (const actId of affectedParentActs) {
				await recomputeIntervalsForAct(tx, actId, userId);
			}
			return rows;
		});
	} catch (err) {
		error(400, (err as Error).message);
	}

	return json(created, { status: 201 });
};
