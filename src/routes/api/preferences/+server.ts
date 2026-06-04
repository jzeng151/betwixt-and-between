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

import { json, error } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-gate.js';
import { getActivePreferences, patchPreferences } from '$lib/server/user-preferences.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	const active = await getActivePreferences(db, userId);
	// `initialized` lets the client distinguish a freshly lazy-created row (never
	// written) from one that already holds the user's prefs — the first-login
	// reconcile signal (T4, codex). `userId` lets the client scope its localStorage
	// cache to the signed-in user so a shared browser can't import a different
	// user's prefs into this account (codex P1). Returning the caller's own id is
	// not a disclosure — it's derived from their session.
	return json({
		data: active.data,
		version: active.version,
		initialized: active.initialized,
		userId,
		// profileId lets the client stamp its pending PATCHes with the profile they
		// were authored against (F2) — a write authored before a profile switch is
		// rejected (409) rather than landing on the newly-active profile.
		profileId: active.profileId
	});
};

export const PATCH: RequestHandler = async (event) => {
	const { db } = event.locals;
	const userId = getUserId(event);
	// Malformed JSON (or a non-object literal like `null`/`42`) must surface as
	// the contract's 400, not an unhandled 500 — patchPreferences can only run its
	// 400 validation once we have an object to read set/unset/version from (codex).
	let body: {
		set?: Record<string, unknown>;
		unset?: string[];
		version?: number;
		profileId?: string;
	};
	try {
		body = (await event.request.json()) as typeof body;
	} catch {
		error(400, 'request body must be valid JSON');
	}
	if (body === null || typeof body !== 'object' || Array.isArray(body)) {
		error(400, 'request body must be a JSON object');
	}
	// patchPreferences validates the patch shape + version (400) and enforces
	// optimistic concurrency (409). `profileId` (optional) guards against a write
	// landing on the wrong profile after a switch (F2) — mismatch → 409.
	const result = await patchPreferences(
		db,
		userId,
		{ set: body.set, unset: body.unset },
		body.version as number,
		body.profileId
	);
	return json({ data: result.data, version: result.version });
};
