// GET /api/factions/[id]/dependents — pre-delete count probe. The UI calls
// this to render "deleting will leave N events with ownership-unknown"
// before posting DELETE. Splitting the count from the destructive action
// keeps DELETE consistent with the project's 204-no-body convention.

import { json } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-gate.js';
import { countFactionDependents } from '$lib/server/world-map-v3.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const count = await countFactionDependents(db, userId, event.params.id);
	return json({ dependentEventCount: count });
};
