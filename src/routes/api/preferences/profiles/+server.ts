// Settings customization Phase 3 — workspace profiles collection (T9).
//
// GET /api/preferences/profiles
//   Lists the current user's profiles (oldest first; "Default" leads). Lazily
//   creates the Default row on first access, so the list is never empty. User
//   is derived from the session — no selector in the URL/body. 401 unauthed.
//
// POST /api/preferences/profiles
//   Body: { name: string }
//   Creates a profile by COPYING the active profile's blob, then activates it
//   (it becomes the active profile). Returns the new profile summary.
//     200 — created; body: ProfileSummary
//     400 — missing/empty/oversized name, malformed JSON
//     401 — unauthenticated
//
// Per-profile mutations (rename, delete, activate) live under [id]/.

import { json, error } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-gate.js';
import { listProfiles, createProfile } from '$lib/server/user-preferences.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const userId = getUserId(event);
	const profiles = await listProfiles(event.locals.db, userId);
	return json({ profiles });
};

export const POST: RequestHandler = async (event) => {
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
	// createProfile validates the name (400) and copies+activates atomically.
	const profile = await createProfile(event.locals.db, userId, body.name as string);
	return json(profile);
};
