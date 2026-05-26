// Factions — World Map v3 Slice 1b. User-scoped via factions.user_id (no
// parent table). All writes route through src/lib/server/world-map-v3.ts
// so the validation + cross-user invariant live in one place.

import { json } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-gate.js';
import { readJson } from '$lib/server/read-json.js';
import { createFaction, listFactions } from '$lib/server/world-map-v3.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const after = event.url.searchParams.get('after');
	const limitRaw = event.url.searchParams.get('limit');
	const limit = limitRaw != null ? Number(limitRaw) : null;
	return json(await listFactions(db, userId, { after, limit }));
};

export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const body = (await readJson(event)) as any;
	const created = await createFaction(db, userId, {
		name: body.name,
		color: body.color,
		styleJsonb: body.styleJsonb ?? null
	});
	return json(created, { status: 201 });
};
