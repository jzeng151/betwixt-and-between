import { json } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-gate.js';
import { readJson } from '$lib/server/read-json.js';
import { deleteFaction, updateFaction } from '$lib/server/world-map-v3.js';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const body = (await readJson(event)) as any;
	const row = await updateFaction(db, userId, event.params.id, body);
	return json(row);
};

export const DELETE: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	await deleteFaction(db, userId, event.params.id);
	return new Response(null, { status: 204 });
};
