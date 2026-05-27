// World Map v3 Slice 2 D3 (T7) — undo endpoint.
//
// POST /api/maps/[id]/events/undo
//   Pops the latest live event by commit order (created_at DESC, id DESC),
//   soft-deletes it (undone_at = now()), and returns the popped row.
//   - 404 if the map doesn't belong to the caller.
//   - 422 if there is nothing to undo.
//   Redo is client-side (re-POST via the existing /events endpoint).

import { json } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-gate.js';
import { undoLatestMapEvent } from '$lib/server/world-map-v3.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const undone = await undoLatestMapEvent(db, userId, event.params.id);
	return json(undone);
};
