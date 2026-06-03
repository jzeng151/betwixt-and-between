// Settings customization Phase 3 — single workspace profile (T9).
//
// PATCH /api/preferences/profiles/[id]
//   Body: { name: string } — rename. Returns the updated ProfileSummary.
//     200 — renamed
//     400 — invalid id / missing-or-empty name / malformed JSON
//     404 — not the caller's profile
//     401 — unauthenticated
//
// DELETE /api/preferences/profiles/[id]
//   Deletes the profile. Guards (server-enforced):
//     409 — the profile is ACTIVE (switch first) or is the LAST profile
//     404 — not the caller's profile
//     400 — invalid id
//     401 — unauthenticated
//     200 — deleted; body { ok: true }

import { json, error } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-gate.js';
import { renameProfile, deleteProfile } from '$lib/server/user-preferences.js';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
	const userId = getUserId(event);
	let body: { name?: unknown };
	try {
		body = (await event.request.json()) as typeof body;
	} catch {
		error(400, 'request body must be valid JSON');
	}
	if (body === null || typeof body !== 'object' || Array.isArray(body)) {
		error(400, 'request body must be a JSON object');
	}
	const profile = await renameProfile(
		event.locals.db,
		userId,
		event.params.id,
		body.name as string
	);
	return json(profile);
};

export const DELETE: RequestHandler = async (event) => {
	const userId = getUserId(event);
	await deleteProfile(event.locals.db, userId, event.params.id);
	return json({ ok: true });
};
