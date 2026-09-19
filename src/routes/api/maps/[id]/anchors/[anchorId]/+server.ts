import { json } from '@sveltejs/kit';
import { getStoryId } from '$lib/server/auth-gate.js';
import { readJson } from '$lib/server/read-json.js';
import { deleteMapAnchor, updateMapAnchor } from '$lib/server/world-map-v3.js';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
	const { db } = event.locals;
	const storyId = await getStoryId(event);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const body = (await readJson(event)) as any;
	const row = await updateMapAnchor(db, storyId, event.params.id, event.params.anchorId, body);
	return json(row);
};

export const DELETE: RequestHandler = async (event) => {
	const { db } = event.locals;
	const storyId = await getStoryId(event);
	await deleteMapAnchor(db, storyId, event.params.id, event.params.anchorId);
	return new Response(null, { status: 204 });
};
