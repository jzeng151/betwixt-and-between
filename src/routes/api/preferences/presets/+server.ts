// Settings customization Phase 3 — appearance presets collection (T10).
//
// GET /api/preferences/presets
//   Returns { builtins, user }: read-only built-in presets (constants) plus the
//   caller's saved presets (oldest first). User derived from session. 401 unauthed.
//
// POST /api/preferences/presets
//   Body: { name: string, appearance: object }
//   Saves an appearance blob as a named preset (the client sends the active
//   profile's current appearance). Returns the new PresetSummary.
//     200 — created; body: PresetSummary
//     400 — missing/empty name, invalid appearance (bad hex / unknown key), bad JSON
//     401 — unauthenticated
//
// Apply is NOT an endpoint: applying a preset is an ordinary PATCH
// /api/preferences the client builds (buildApplyPresetPatch).

import { json, error } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-gate.js';
import { listPresets, createPreset } from '$lib/server/appearance-presets.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const userId = getUserId(event);
	const presets = await listPresets(event.locals.db, userId);
	return json(presets);
};

export const POST: RequestHandler = async (event) => {
	const userId = getUserId(event);
	let body: { name?: unknown; appearance?: unknown };
	try {
		body = (await event.request.json()) as typeof body;
	} catch {
		error(400, 'request body must be valid JSON');
	}
	if (body === null || typeof body !== 'object' || Array.isArray(body)) {
		error(400, 'request body must be a JSON object');
	}
	const preset = await createPreset(
		event.locals.db,
		userId,
		body.name as string,
		body.appearance
	);
	return json(preset);
};
