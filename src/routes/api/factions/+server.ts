// Factions — World Map v3 Slice 1b. User-scoped via factions.user_id (no
// parent table). All writes route through src/lib/server/world-map-v3.ts
// so the validation + cross-user invariant live in one place.

import { json } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-gate.js';
import { createFaction, listFactions } from '$lib/server/world-map-v3.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	return json(await listFactions(db, userId));
};

export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const body = await event.request.json();
	const created = await createFaction(db, userId, {
		name: body.name,
		color: body.color,
		styleJsonb: body.styleJsonb ?? null
	});
	return json(created, { status: 201 });
};
