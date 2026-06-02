// Settings customization Phase 1 — user preferences API (T3).
//
// GET /api/preferences
//   Returns the current user's ACTIVE preference blob + version. Lazily
//   creates the Default profile on first access. The user is derived from the
//   session (getUserId) — there is NO user selector in the URL/body, so a
//   cross-user read is structurally impossible (codex outside-voice: cross-user
//   coverage belongs in helper tests, not as a public-API behavior). 401 when
//   unauthenticated.
//
// PATCH /api/preferences
//   Body: { set?: object, unset?: string[], version: number }
//   Applies the patch (deep-merge `set`, delete `unset` paths) with Approach-B
//   optimistic concurrency. Returns the merged blob + the new version.
//     200 — applied; body { data, version }
//     400 — malformed patch / invalid color / unknown key / oversized blob /
//           missing-or-non-integer version
//     409 — stale version: another writer bumped it; the client re-GETs, re-
//           applies its pending patch onto the fresh base, and retries (T4)
//     401 — unauthenticated
//
// No POST/DELETE: GET lazily creates the row, PATCH covers all mutation.
// Profile create/switch/delete arrives with workspace profiles (Phase 3).

import { json } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-gate.js';
import { getActivePreferences, patchPreferences } from '$lib/server/user-preferences.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const active = await getActivePreferences(db, userId);
	return json({ data: active.data, version: active.version });
};

export const PATCH: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const body = (await event.request.json()) as {
		set?: Record<string, unknown>;
		unset?: string[];
		version?: number;
	};
	// patchPreferences validates the patch shape + version (400) and enforces
	// optimistic concurrency (409). We pass body fields through verbatim.
	const result = await patchPreferences(
		db,
		userId,
		{ set: body.set, unset: body.unset },
		body.version as number
	);
	return json({ data: result.data, version: result.version });
};
