import { json, error } from '@sveltejs/kit';
import { relationships, entities } from '$lib/server/db/schema.js';
import { RelationshipType } from '$lib/server/db/schema.js';
import { and, eq } from 'drizzle-orm';
import { getUserId } from '$lib/server/auth-gate.js';
import { resolveRelationshipBounds } from '$lib/server/intervals.js';
import { assertPartOfInvariants } from '$lib/server/location-hierarchy.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const rows = await db
		.select()
		.from(relationships)
		.where(eq(relationships.userId, userId));
	const fromId = event.url.searchParams.get('fromId');
	const toId = event.url.searchParams.get('toId');
	const filtered = rows.filter(
		(r) => (!fromId || r.fromId === fromId) && (!toId || r.toId === toId)
	);
	return json(filtered);
};

export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const body = await event.request.json();
	const { fromId, toId, type, label, startActId, startSceneId, endActId, endSceneId, revealedAtPosition } = body;

	if (!RelationshipType.includes(type)) {
		error(400, 'Invalid relationship type');
	}
	if (!fromId || !toId) {
		error(400, 'fromId and toId are required');
	}

	// Both endpoints must belong to the user (cross-user FK = leak).
	const [from] = await db
		.select()
		.from(entities)
		.where(and(eq(entities.id, fromId), eq(entities.userId, userId)));
	if (!from) error(400, 'fromId entity not found');

	const [to] = await db
		.select()
		.from(entities)
		.where(and(eq(entities.id, toId), eq(entities.userId, userId)));
	if (!to) error(400, 'toId entity not found');

	// appears_in is no longer writable here — character/act presence is owned by
	// the timeline's intervals model. Use POST /api/intervals instead.
	if (type === 'appears_in') {
		error(400, 'appears_in is no longer a writable relationship type — use /api/intervals');
	}

	if (type === 'part_of') {
		await assertPartOfInvariants(db, userId, fromId, toId);
	}

	let startPosition: number | null = null;
	let endPosition: number | null = null;
	try {
		const bounds = await resolveRelationshipBounds(
			db,
			{
				startActId: startActId ?? null,
				startSceneId: startSceneId ?? null,
				endActId: endActId ?? null,
				endSceneId: endSceneId ?? null
			},
			userId
		);
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
				userId,
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
