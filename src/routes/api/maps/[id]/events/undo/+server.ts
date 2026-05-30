// World Map v3 Slice 2 D3 (T7) — undo endpoint.
// Slice 3 B5 — grouped undo for chunked brush strokes.
//
// POST /api/maps/[id]/events/undo
//   Pops the latest live event by commit order (created_at DESC, id DESC),
//   soft-deletes it (undone_at = now()), and returns the affected rows as
//   an array. For standalone events (command_id IS NULL) the array has
//   one element; for chunked strokes (Slice 3 paint_cells with non-NULL
//   command_id) all sibling rows sharing that command_id are soft-deleted
//   atomically and returned in commit-DESC order.
//   - 404 if the map doesn't belong to the caller.
//   - 422 if there is nothing to undo.
//   Redo is client-side (re-POST via the existing /events endpoint);
//   grouped strokes redo with a fresh command_id assigned by the client.

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
