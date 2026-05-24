import { json } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-gate.js';
import { createMapAnchor, listMapAnchors } from '$lib/server/world-map-v3.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	return json(await listMapAnchors(db, userId, event.params.id));
};

export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const body = await event.request.json();
	const created = await createMapAnchor(db, userId, event.params.id, {
		tPosition: body.tPosition,
		stateJsonb: body.stateJsonb
	});
	return json(created, { status: 201 });
};
