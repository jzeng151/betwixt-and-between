import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/index.js';
import { relationships, entities } from '$lib/server/db/schema.js';
import { RelationshipType } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { resolveRelationshipBounds } from '$lib/server/intervals.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, url }) => {
	const db = await getDb(platform?.env);
	const rows = await db.select().from(relationships);
	const fromId = url.searchParams.get('fromId');
	const toId = url.searchParams.get('toId');
	const filtered = rows.filter(
		(r) => (!fromId || r.fromId === fromId) && (!toId || r.toId === toId)
	);
	return json(filtered);
};

export const POST: RequestHandler = async ({ platform, request }) => {
	const db = await getDb(platform?.env);
	const body = await request.json();
	const { fromId, toId, type, label, startActId, startSceneId, endActId, endSceneId, revealedAtPosition } = body;

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

	let startPosition: number | null = null;
	let endPosition: number | null = null;
	try {
		const bounds = await resolveRelationshipBounds(db, {
			startActId: startActId ?? null,
			startSceneId: startSceneId ?? null,
			endActId: endActId ?? null,
			endSceneId: endSceneId ?? null
		});
		startPosition = bounds.startPosition;
		endPosition = bounds.endPosition;
	} catch (err) {
		error(400, (err as Error).message);
	}

	let created;
	try {
		[created] = await db
			.insert(relationships)
			.values({
				fromId,
				toId,
				type,
				label: label ?? null,
				startActId: startActId ?? null,
				startSceneId: startSceneId ?? null,
				endActId: endActId ?? null,
				endSceneId: endSceneId ?? null,
				startPosition,
				endPosition,
				revealedAtPosition: revealedAtPosition ?? null
			})
			.returning();
	} catch (err) {
		const code = (err as { code?: string }).code ?? '';
		const msg = (err as Error).message ?? '';
		if (code === '23505' || msg.includes('unique') || msg.includes('duplicate')) {
			error(409, 'A relationship with these temporal bounds already exists');
		}
		throw err;
	}

	return json(created, { status: 201 });
};
