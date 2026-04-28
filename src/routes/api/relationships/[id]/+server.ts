import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { relationships, intervals } from '$lib/server/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { isSyntheticAppearsInId } from '$lib/server/timeline-compat.js';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params }) => {
	// PR 1 compat: synthetic appears_in ids look like `compat:{entityId}:{actId}`.
	// Route those to deleting the corresponding interval(s). Throwaway code,
	// deleted in PR 2.
	if (isSyntheticAppearsInId(params.id)) {
		const [, entityId, actId] = params.id.split(':');
		if (!entityId || !actId) error(404, 'Malformed synthetic relationship id');
		// Delete intervals where the entity's presence overlaps THIS act and
		// the interval was a single-act presence (start_act_id === end_act_id === actId).
		// More complex multi-act intervals are not deletable via the synthetic
		// edge UI; users must use the V2 timeline directly. PR 1 migration only
		// produces single-act intervals so this is fine for the bridge.
		const matching = await db
			.select()
			.from(intervals)
			.where(
				and(
					eq(intervals.entityId, entityId),
					eq(intervals.startActId, actId),
					eq(intervals.endActId, actId)
				)
			);
		if (matching.length === 0) error(404, 'No matching interval found');
		for (const row of matching) {
			await db.delete(intervals).where(eq(intervals.id, row.id));
		}
		return new Response(null, { status: 204 });
	}

	// PR 1 hijack returns ids prefixed `interval:` for new appears_in writes.
	if (params.id.startsWith('interval:')) {
		const realId = params.id.slice('interval:'.length);
		const [row] = await db.select().from(intervals).where(eq(intervals.id, realId));
		if (!row) error(404, 'Interval not found');
		await db.delete(intervals).where(eq(intervals.id, realId));
		return new Response(null, { status: 204 });
	}

	const [rel] = await db.select().from(relationships).where(eq(relationships.id, params.id));
	if (!rel) error(404, 'Relationship not found');

	await db.delete(relationships).where(eq(relationships.id, params.id));
	return new Response(null, { status: 204 });
};
