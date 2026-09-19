import { json } from '@sveltejs/kit';
import { getStoryId } from '$lib/server/auth-gate.js';
import { readJson } from '$lib/server/read-json.js';
import { deleteFaction, updateFaction } from '$lib/server/world-map-v3.js';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
	const { db } = event.locals;
	const storyId = await getStoryId(event);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const body = (await readJson(event)) as any;
	const row = await updateFaction(db, storyId, event.params.id, body);
	return json(row);
};

export const DELETE: RequestHandler = async (event) => {
	const { db } = event.locals;
	const storyId = await getStoryId(event);
	await deleteFaction(db, storyId, event.params.id);
	return new Response(null, { status: 204 });
};
