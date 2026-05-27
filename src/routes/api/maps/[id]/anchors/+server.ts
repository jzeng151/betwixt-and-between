import { json } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-gate.js';
import { readJson } from '$lib/server/read-json.js';
import { createMapAnchor, listMapAnchors } from '$lib/server/world-map-v3.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const after = event.url.searchParams.get('after');
	const limitRaw = event.url.searchParams.get('limit');
	const limit = limitRaw != null ? Number(limitRaw) : null;
	return json(await listMapAnchors(db, userId, event.params.id, { after, limit }));
};

export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const body = (await readJson(event)) as any;
	const created = await createMapAnchor(db, userId, event.params.id, {
		tPosition: body.tPosition,
		stateJsonb: body.stateJsonb
	});
	return json(created, { status: 201 });
};
