// Settings customization Phase 3 — activate a workspace profile (T9).
//
// POST /api/preferences/profiles/[id]/activate
//   Makes [id] the active profile (deactivate-all → activate-target in one
//   transaction; never leaves two — or zero — active rows). No body.
//     200 — activated; body { ok: true }
//     400 — invalid id
//     404 — not the caller's profile
//     401 — unauthenticated

import { json } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-gate.js';
import { activateProfile } from '$lib/server/user-preferences.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const userId = getUserId(event);
	await activateProfile(event.locals.db, userId, event.params.id);
	return json({ ok: true });
};
