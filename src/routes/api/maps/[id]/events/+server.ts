import { json } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-gate.js';
import { readJson } from '$lib/server/read-json.js';
import { createMapEvent, listMapEvents } from '$lib/server/world-map-v3.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	return json(await listMapEvents(db, userId, event.params.id));
};

export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const body = (await readJson(event)) as any;
	const created = await createMapEvent(db, userId, event.params.id, {
		tPosition: body.tPosition,
		kind: body.kind,
		payloadJsonb: body.payloadJsonb,
		sourceEventId: body.sourceEventId ?? null
	});
	return json(created, { status: 201 });
};
