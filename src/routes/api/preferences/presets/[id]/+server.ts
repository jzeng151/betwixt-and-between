// Settings customization Phase 3 — single appearance preset (T10).
//
// DELETE /api/preferences/presets/[id]
//   Deletes a user-saved preset.
//     200 — deleted; body { ok: true }
//     400 — invalid id (built-in `builtin:*` ids fail the uuid guard → not deletable)
//     404 — not the caller's preset
//     401 — unauthenticated

import { json } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-gate.js';
import { deletePreset } from '$lib/server/appearance-presets.js';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async (event) => {
	const userId = getUserId(event);
	await deletePreset(event.locals.db, userId, event.params.id);
	return json({ ok: true });
};
