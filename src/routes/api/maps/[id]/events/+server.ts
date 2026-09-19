import { json } from '@sveltejs/kit';
import { getStoryId } from '$lib/server/auth-gate.js';
import { readJson } from '$lib/server/read-json.js';
import { createMapEvent, listMapEvents } from '$lib/server/world-map-v3.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const storyId = await getStoryId(event);
	const after = event.url.searchParams.get('after');
	const limitRaw = event.url.searchParams.get('limit');
	const limit = limitRaw != null ? Number(limitRaw) : null;
	return json(await listMapEvents(db, storyId, event.params.id, { after, limit }));
};

export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const storyId = await getStoryId(event);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const body = (await readJson(event)) as any;
	const created = await createMapEvent(db, storyId, event.params.id, {
		tPosition: body.tPosition,
		kind: body.kind,
		payloadJsonb: body.payloadJsonb,
		sourceEventId: body.sourceEventId ?? null,
		// Slice 3 B5 — commandId groups chunked-stroke events under one undo
		// command. Null/undefined for standalone events (legacy behavior).
		commandId: body.commandId ?? null
	});
	return json(created, { status: 201 });
};
