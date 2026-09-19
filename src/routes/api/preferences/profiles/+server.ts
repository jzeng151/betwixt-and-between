// Settings customization Phase 3 — workspace profiles collection (T9).
//
// GET /api/preferences/profiles
//   Lists the current story's profiles (oldest first; "Default" leads). Lazily
//   creates the Default row on first access. getStoryId verifies ownership.
//
// POST /api/preferences/profiles
//   Body: { name: string, profileId?: UUID }
//   Creates a profile by COPYING the active profile's blob, then activates it
//   (it becomes the active profile). Returns the new profile summary.
//   Reusing profileId returns the existing profile without copying or activating again.
//     200 — created or replayed; body: ProfileSummary
//     400 — missing/empty/oversized name, invalid profileId, malformed JSON
//     401 — unauthenticated
//     409 — profileId exists with a different name
//
// Per-profile mutations (rename, delete, activate) live under [id]/.

import { json, error } from '@sveltejs/kit';
import { getStoryId } from '$lib/server/auth-gate.js';
import { listProfiles, createProfile } from '$lib/server/user-preferences.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const storyId = await getStoryId(event);
	const profiles = await listProfiles(event.locals.db, storyId);
	return json({ profiles });
};

export const POST: RequestHandler = async (event) => {
	const storyId = await getStoryId(event);
	let body: { name?: unknown; profileId?: unknown };
	try {
		body = (await event.request.json()) as typeof body;
	} catch {
		error(400, 'request body must be valid JSON');
	}
	if (body === null || typeof body !== 'object' || Array.isArray(body)) {
		error(400, 'request body must be a JSON object');
	}
	// createProfile validates the name (400) and copies+activates atomically.
	const profile = await createProfile(event.locals.db, storyId, body.name as string, body.profileId as string | undefined);
	return json(profile);
};
