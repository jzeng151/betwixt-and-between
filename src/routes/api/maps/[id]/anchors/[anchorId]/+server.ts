import { json } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-gate.js';
import { deleteMapAnchor, updateMapAnchor } from '$lib/server/world-map-v3.js';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const body = await event.request.json();
	const row = await updateMapAnchor(db, userId, event.params.id, event.params.anchorId, body);
	return json(row);
};

export const DELETE: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	await deleteMapAnchor(db, userId, event.params.id, event.params.anchorId);
	return new Response(null, { status: 204 });
};
