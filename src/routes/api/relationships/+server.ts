import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { relationships, entities } from '$lib/server/db/schema.js';
import { RelationshipType } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { writeInterval } from '$lib/server/intervals.js';
import { getAppearsInRelationships } from '$lib/server/timeline-compat.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const realRows = await db.select().from(relationships);

	// PR 1 compat layer: synthesize appears_in-shaped rows from intervals so
	// StoryGraph keeps drawing those edges after the migration removes real
	// appears_in rows. Throwaway, deleted in PR 2.
	const synth = await getAppearsInRelationships(db);

	// Optional simple filter via query strings used by some callers.
	const fromId = url.searchParams.get('fromId');
	const toId = url.searchParams.get('toId');
	const all = [...realRows, ...synth];
	const filtered = all.filter(
		(r) => (!fromId || r.fromId === fromId) && (!toId || r.toId === toId)
	);
	return json(filtered);
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { fromId, toId, type, label } = body;

	if (!RelationshipType.includes(type)) {
		error(400, 'Invalid relationship type');
	}
	if (!fromId || !toId) {
		error(400, 'fromId and toId are required');
	}

	const [from] = await db.select().from(entities).where(eq(entities.id, fromId));
	if (!from) error(400, 'fromId entity not found');

	const [to] = await db.select().from(entities).where(eq(entities.id, toId));
	if (!to) error(400, 'toId entity not found');

	// =============================================================================
	// PR 1 hijack — appears_in writes route to writeInterval(). Throwaway code,
	// deleted in PR 2 when V2 timeline owns the create-presence flow directly.
	// See CONSIDERATIONS.md → "/plan-eng-review resolutions item 1".
	// =============================================================================
	if (type === 'appears_in') {
		if (to.type !== 'Act') {
			error(400, `appears_in requires toId to be an Act (got type='${to.type}')`);
		}
		try {
			const interval = await writeInterval(db, {
				entityId: fromId,
				startActId: toId,
				endActId: toId
			});
			// Return a row in the EXISTING relationships shape so the UI doesn't
			// need to know it's actually an interval. The id is the interval's
			// id, prefixed so callers can detect synthetic origin.
			return json(
				{
					id: `interval:${interval.id}`,
					fromId,
					toId,
					label: label ?? null,
					type: 'appears_in'
				},
				{ status: 201 }
			);
		} catch (err) {
			error(400, (err as Error).message);
		}
	}

	const [created] = await db
		.insert(relationships)
		.values({ fromId, toId, type, label: label ?? null })
		.returning();

	return json(created, { status: 201 });
};
