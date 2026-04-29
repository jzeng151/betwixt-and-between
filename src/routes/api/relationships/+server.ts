import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { relationships, entities } from '$lib/server/db/schema.js';
import { RelationshipType } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const rows = await db.select().from(relationships);
	const fromId = url.searchParams.get('fromId');
	const toId = url.searchParams.get('toId');
	const filtered = rows.filter(
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

	// appears_in is no longer writable here — character/act presence is owned by
	// the timeline's intervals model. Use POST /api/intervals instead.
	if (type === 'appears_in') {
		error(400, 'appears_in is no longer a writable relationship type — use /api/intervals');
	}

	const [created] = await db
		.insert(relationships)
		.values({ fromId, toId, type, label: label ?? null })
		.returning();

	return json(created, { status: 201 });
};
