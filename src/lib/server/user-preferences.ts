/**
 * Server chokepoint for user_preferences (Settings customization Phase 1, T2).
 *
 * Every read/write of a user's preference blob goes through here so the
 * cross-user invariant (rows scoped by session-derived userId), the
 * Approach-B optimistic concurrency, and the value validation live in exactly
 * one place. The API handlers (T3) call into these; the client store (T4) is
 * the only consumer.
 *
 * Concurrency (Approach B, codex outside-voice): the write is an ATOMIC
 * conditional UPDATE keyed on the client's last-known version —
 *   UPDATE ... SET data=$merged, version=version+1
 *    WHERE user_id=$u AND profile_id=$p AND version=$clientVersion
 * Zero rows affected → the client raced another writer → 409. There is no
 * read-modify-write TOCTOU window: the merge is computed from the current row
 * and only committed if version is still what the client based its patch on.
 * `version` is bumped explicitly here; the bump_updated_at trigger maintains
 * updated_at separately (the two version concepts never conflate).
 *
 * Clear-to-default (T2A): a PATCH carries `{ set, unset }`. `set` deep-merges
 * (can only add/overwrite); `unset` deletes dotted paths (the only way to
 * remove a key so the read-side cascade falls back to the built-in default).
 */

import { and, eq, sql } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { userPreferences, EntityType, RelationshipType } from './db/schema.js';
import type { Db } from './intervals.js';
import { isHexColor } from './validation.js';
import { CHARACTER_ROLES } from '../character-roles.js';
import { deepMerge, applyUnset, isPlainObject, isSafeUnsetPath } from '../preferences-merge.js';

/** Max serialized blob size. Generous for palettes + window + graph prefs; a
 *  guard against a client (or attacker) bloating the row and every SSR read. */
const MAX_BLOB_BYTES = 64 * 1024;

export interface PreferencesPatch {
	/** Partial subtree to deep-merge into the blob. */
	set?: Record<string, unknown>;
	/** Dotted paths to delete (reset-to-default). */
	unset?: string[];
}

export interface ActivePreferences {
	profileId: string;
	name: string;
	data: Record<string, unknown>;
	version: number;
}

/**
 * Return the user's active preference row, lazily creating the "Default" row
 * on first access. The INSERT is `ON CONFLICT DO NOTHING` against the partial
 * unique index user_preferences_one_active, so two concurrent first-requests
 * resolve to the same single active row instead of duplicating (codex).
 */
export async function getActivePreferences(db: Db, userId: string): Promise<ActivePreferences> {
	const found = await selectActive(db, userId);
	if (found) return found;

	await db.insert(userPreferences).values({ userId, name: 'Default' }).onConflictDoNothing();

	const created = await selectActive(db, userId);
	if (!created) {
		// Should be unreachable: the row either existed, we created it, or a
		// racing request created it (DO NOTHING) and it's now selectable.
		error(500, 'failed to initialize user preferences');
	}
	return created;
}

async function selectActive(db: Db, userId: string): Promise<ActivePreferences | null> {
	const [row] = await db
		.select({
			profileId: userPreferences.profileId,
			name: userPreferences.name,
			data: userPreferences.data,
			version: userPreferences.version
		})
		.from(userPreferences)
		.where(and(eq(userPreferences.userId, userId), eq(userPreferences.isActive, 1)))
		.limit(1);
	if (!row) return null;
	return {
		profileId: row.profileId,
		name: row.name,
		data: (row.data ?? {}) as Record<string, unknown>,
		version: row.version
	};
}

/**
 * Apply a {set, unset} patch to the user's active preferences with optimistic
 * concurrency. Throws 400 on a malformed patch / invalid color value, 409 when
 * `clientVersion` is stale (the client must re-fetch and re-apply).
 */
export async function patchPreferences(
	db: Db,
	userId: string,
	patch: PreferencesPatch,
	clientVersion: number
): Promise<ActivePreferences> {
	validatePatchShape(patch, clientVersion);

	const active = await getActivePreferences(db, userId);

	// Merge onto the CURRENT row data. The conditional UPDATE below only
	// commits if version is still clientVersion — so a successful write always
	// used the base the client saw, and a raced write is discarded (→ 409).
	const merged = applyUnset(deepMerge(active.data, patch.set ?? {}), patch.unset ?? []);
	validateMergedData(merged);

	const updated = await db
		.update(userPreferences)
		.set({ data: merged, version: sql`${userPreferences.version} + 1` })
		.where(
			and(
				eq(userPreferences.userId, userId),
				eq(userPreferences.profileId, active.profileId),
				eq(userPreferences.version, clientVersion)
			)
		)
		.returning();

	if (updated.length === 0) {
		// Stale — another writer (or device) bumped the version between the
		// client's last GET and this PATCH. The client re-GETs, re-applies its
		// pending patch onto the fresh base, and retries (T4).
		error(409, 'preferences version is stale; re-fetch and retry');
	}

	return { profileId: active.profileId, name: active.name, data: merged, version: updated[0].version };
}

// ── validation ──────────────────────────────────────────────────────────────

function validatePatchShape(patch: PreferencesPatch, clientVersion: number): void {
	if (!Number.isInteger(clientVersion) || clientVersion < 1) {
		error(400, 'clientVersion must be a positive integer');
	}
	if (patch == null || typeof patch !== 'object') error(400, 'patch must be an object');
	if (patch.set !== undefined && !isPlainObject(patch.set)) {
		error(400, 'patch.set must be an object');
	}
	if (patch.unset !== undefined) {
		if (!Array.isArray(patch.unset)) error(400, 'patch.unset must be an array');
		for (const p of patch.unset) {
			if (!isSafeUnsetPath(p)) error(400, `patch.unset path is invalid: ${String(p)}`);
		}
	}
	if (patch.set === undefined && patch.unset === undefined) {
		error(400, 'patch must contain set and/or unset');
	}
}

/**
 * Validate the MERGED result (not the partial) so no set/unset combination can
 * leave an invalid state. Guards the color-bearing fields that reach `var()`
 * render paths plus the total blob size. Does NOT re-implement the client's
 * full Preferences type — it guards what can poison rendering or storage.
 */
function validateMergedData(data: Record<string, unknown>): void {
	const size = JSON.stringify(data).length;
	if (size > MAX_BLOB_BYTES) {
		error(400, `preferences blob too large (${size} > ${MAX_BLOB_BYTES} bytes)`);
	}
	const app = data.appearance;
	if (app === undefined) return;
	if (!isPlainObject(app)) error(400, 'appearance must be an object');
	if (app.theme !== undefined && app.theme !== 'dark' && app.theme !== 'light') {
		error(400, "appearance.theme must be 'dark' or 'light'");
	}
	if (app.accentColor !== undefined && !isHexColor(app.accentColor)) {
		error(400, 'appearance.accentColor must be a hex color');
	}
	validateColorMap(app.entityTypeColors, EntityType, 'appearance.entityTypeColors');
	validateColorMap(app.relationshipTypeColors, RelationshipType, 'appearance.relationshipTypeColors');
	validateColorMap(app.roleColors, CHARACTER_ROLES, 'appearance.roleColors');
}

function validateColorMap(
	value: unknown,
	allowedKeys: readonly string[],
	label: string
): void {
	if (value === undefined) return;
	if (!isPlainObject(value)) error(400, `${label} must be an object`);
	const allowed = new Set(allowedKeys);
	for (const [k, v] of Object.entries(value)) {
		if (!allowed.has(k)) error(400, `${label}: unknown key '${k}'`);
		if (!isHexColor(v)) error(400, `${label}.${k} must be a hex color`);
	}
}
