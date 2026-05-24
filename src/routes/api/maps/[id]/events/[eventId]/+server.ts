// map_events is append-only per design (event log is truth of history).
// Mutations are delete-then-insert at the API layer; this handler only
// exposes DELETE. To "edit" an event, the client deletes and re-creates.

import { getUserId } from '$lib/server/auth-gate.js';
import { deleteMapEvent } from '$lib/server/world-map-v3.js';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	await deleteMapEvent(db, userId, event.params.id, event.params.eventId);
	return new Response(null, { status: 204 });
};
