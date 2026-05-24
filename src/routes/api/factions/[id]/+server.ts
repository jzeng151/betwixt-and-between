import { json } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-gate.js';
import { deleteFaction, updateFaction } from '$lib/server/world-map-v3.js';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const body = await event.request.json();
	const row = await updateFaction(db, userId, event.params.id, body);
	return json(row);
};

export const DELETE: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const result = await deleteFaction(db, userId, event.params.id);
	return json(result);
};
