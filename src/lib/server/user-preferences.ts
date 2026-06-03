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
import { isHexColor, isUuid } from './validation.js';
import { CHARACTER_ROLES } from '../character-roles.js';
import { APP_IDS } from '../os/app-ids.js';
import { deepMerge, applyUnset, isPlainObject, isSafeUnsetPath } from '../preferences-merge.js';
import { PREFERENCES_CODE_MAX_VERSION, type ProfileSummary } from '../types/preferences.js';

export type { ProfileSummary };

/** Max serialized blob size. Generous for palettes + window + graph prefs; a
 *  guard against a client (or attacker) bloating the row and every SSR read. */
export const MAX_BLOB_BYTES = 64 * 1024;

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
	/**
	 * True once this user's preferences have been written by the client at least
	 * once (`initialized_from_client_at` is set). False on a freshly lazy-created
	 * Default row — the signal the client uses to migrate existing localStorage
	 * prefs up instead of being overwritten by server defaults (first-login
	 * reconcile, codex).
	 */
	initialized: boolean;
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
			version: userPreferences.version,
			initializedFromClientAt: userPreferences.initializedFromClientAt
		})
		.from(userPreferences)
		.where(and(eq(userPreferences.userId, userId), eq(userPreferences.isActive, 1)))
		.limit(1);
	if (!row) return null;
	return {
		profileId: row.profileId,
		name: row.name,
		data: (row.data ?? {}) as Record<string, unknown>,
		version: row.version,
		initialized: row.initializedFromClientAt != null
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
	clientVersion: number,
	expectedProfileId?: string
): Promise<ActivePreferences> {
	validatePatchShape(patch, clientVersion);

	// Run the read-check-write under the per-user profile lock so the F2 check is
	// ATOMIC with the write: without it a concurrent activate (another tab) between
	// the active read and the UPDATE would let the write land on the now-inactive
	// old profile (the UPDATE keys on active.profileId, not is_active), silently
	// succeeding against stale state instead of returning the profile-change 409
	// (codex). The lock serializes against activate/create/delete.
	return await db.transaction(async (tx) => {
		await lockUserProfiles(tx, userId);
		const active = await getActivePreferences(tx, userId);

		// F2 (profile-switch concurrency): a patch authored against one profile must
		// never land on another after the user switches the active profile mid-flight.
		// Under the lock, active.profileId is authoritative through the UPDATE below.
		if (expectedProfileId !== undefined && expectedProfileId !== active.profileId) {
			error(409, 'active profile changed; re-fetch and retry');
		}

		// Merge onto the CURRENT row data. The conditional UPDATE below only
		// commits if version is still clientVersion — so a successful write always
		// used the base the client saw, and a raced write is discarded (→ 409).
		const merged = applyUnset(deepMerge(active.data, patch.set ?? {}), patch.unset ?? []);
		validateMergedData(merged);

		const updated = await tx
			.update(userPreferences)
			// Stamp initialized_from_client_at on the FIRST client write (COALESCE
			// keeps it stable thereafter) — the durable first-login-reconcile marker.
			// Not updated_at/created_at, so explicit set is allowed (CLAUDE.md trigger
			// convention covers only the timestamp pair the trigger maintains).
			.set({
				data: merged,
				version: sql`${userPreferences.version} + 1`,
				initializedFromClientAt: sql`coalesce(${userPreferences.initializedFromClientAt}, now())`
			})
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

		// A successful write always sets the marker (COALESCE above), so the row is
		// initialized from here on.
		return {
			profileId: active.profileId,
			name: active.name,
			data: merged,
			version: updated[0].version,
			initialized: true
		};
	});
}

// ── workspace profiles (Phase 3, T9) ────────────────────────────────────────
//
// The table was profile-shaped from Phase 1 day one: (user_id, profile_id) PK +
// the is_active 0/1 flag + the partial unique index user_preferences_one_active
// ("at most one active row per user"). So profiles are "allow N rows + a
// switcher" with NO schema migration.
//
// ACTIVATE is the load-bearing operation. The design proposed a single
//   UPDATE ... SET is_active = CASE WHEN profile_id=$t THEN 1 ELSE 0 END
// but that is unsafe against the partial unique index: Postgres checks the
// index per-row mid-statement, so if the target row flips to is_active=1 BEFORE
// the previously-active row flips to 0, the two coexist for an instant and the
// statement aborts with a unique_violation (PGlite can mask this; real
// Postgres/Neon does not). We instead deactivate-all THEN activate-target
// inside a transaction — there is never a transient two-active state, and row
// locking serializes concurrent activates so exactly one wins.

/** Max profile / preset display-name length. Generous; guards row bloat + UI. */
const MAX_NAME_LEN = 80;

/** Validate + trim a profile/preset display name. 400 on non-string/empty/long.
 *  Shared by profiles (here) and the appearance-presets module. */
export function validateDisplayName(name: unknown): string {
	if (typeof name !== 'string') error(400, 'name must be a string');
	const trimmed = name.trim();
	if (trimmed.length === 0) error(400, 'name must not be empty');
	if (trimmed.length > MAX_NAME_LEN) error(400, `name must be at most ${MAX_NAME_LEN} characters`);
	return trimmed;
}

function toSummary(row: {
	profileId: string;
	name: string;
	isActive: number;
	version: number;
}): ProfileSummary {
	return {
		profileId: row.profileId,
		name: row.name,
		isActive: row.isActive === 1,
		version: row.version
	};
}

/** List a user's profiles, oldest first (so "Default" leads). */
export async function listProfiles(db: Db, userId: string): Promise<ProfileSummary[]> {
	// Ensure the lazy Default row exists so a brand-new user sees one profile,
	// not an empty list (mirrors getActivePreferences' lazy-create contract).
	await getActivePreferences(db, userId);
	const rows = await db
		.select({
			profileId: userPreferences.profileId,
			name: userPreferences.name,
			isActive: userPreferences.isActive,
			version: userPreferences.version
		})
		.from(userPreferences)
		.where(eq(userPreferences.userId, userId))
		.orderBy(userPreferences.createdAt);
	return rows.map(toSummary);
}

/**
 * Create a new profile by COPYING the active profile's blob (Open Q2 resolved:
 * "fork my current setup"), then ACTIVATE it atomically — the created profile
 * becomes active (design interaction-state contract). One transaction so the
 * copy + the active-swap commit together and never leave two active rows.
 */
export async function createProfile(db: Db, userId: string, name: string): Promise<ProfileSummary> {
	const profileName = validateDisplayName(name);
	return await db.transaction(async (tx) => {
		await lockUserProfiles(tx, userId);
		const active = await getActivePreferences(tx, userId);
		// Bare .returning() (no column config): the Db union only exposes the
		// zero-arg overload, so we read the full row and pick fields.
		const [inserted] = await tx
			.insert(userPreferences)
			// Stamp initialized_from_client_at: the copy carries the user's real
			// active blob, so it is NOT a fresh first-login row. Without this the
			// copied profile reads back initialized:false and a later hydrate would
			// run the first-login reconcile and overwrite its saved data (codex).
			.values({
				userId,
				name: profileName,
				isActive: 0,
				data: active.data,
				initializedFromClientAt: sql`now()`
			})
			.returning();
		await activateInTx(tx, userId, inserted.profileId);
		return { profileId: inserted.profileId, name: profileName, isActive: true, version: inserted.version };
	});
}

/** Rename a profile. 404 if it isn't the caller's. */
export async function renameProfile(
	db: Db,
	userId: string,
	profileId: string,
	name: string
): Promise<ProfileSummary> {
	if (!isUuid(profileId)) error(400, 'invalid profileId');
	const profileName = validateDisplayName(name);
	const updated = await db
		.update(userPreferences)
		.set({ name: profileName })
		.where(and(eq(userPreferences.userId, userId), eq(userPreferences.profileId, profileId)))
		.returning();
	if (updated.length === 0) error(404, 'profile not found');
	return toSummary(updated[0]);
}

/**
 * Delete a profile. Guards (server-enforced): cannot delete the ACTIVE profile
 * (switch first) and cannot delete the LAST profile (a user always has ≥1).
 */
export async function deleteProfile(db: Db, userId: string, profileId: string): Promise<void> {
	if (!isUuid(profileId)) error(400, 'invalid profileId');
	await db.transaction(async (tx) => {
		await lockUserProfiles(tx, userId);
		const rows = await tx
			.select({ profileId: userPreferences.profileId, isActive: userPreferences.isActive })
			.from(userPreferences)
			.where(eq(userPreferences.userId, userId));
		const target = rows.find((r) => r.profileId === profileId);
		if (!target) error(404, 'profile not found');
		if (target.isActive === 1) error(409, 'cannot delete the active profile; switch first');
		if (rows.length <= 1) error(409, 'cannot delete the last profile');
		// Lock held + `is_active = 0` in the predicate: a concurrent activate that
		// flipped this row active (after the guard read) can't be silently deleted
		// out from under the user, leaving zero active rows (codex).
		await tx
			.delete(userPreferences)
			.where(
				and(
					eq(userPreferences.userId, userId),
					eq(userPreferences.profileId, profileId),
					eq(userPreferences.isActive, 0)
				)
			);
	});
}

/**
 * Activate a profile: deactivate every active row, then activate the target —
 * see the section header for why this is two statements, not a CASE. Validates
 * target existence/ownership FIRST so a bad id can't deactivate everything and
 * leave the user with zero active rows (the partial unique index enforces
 * at-most-one, not at-least-one — F2-adjacent).
 */
export async function activateProfile(db: Db, userId: string, profileId: string): Promise<void> {
	if (!isUuid(profileId)) error(400, 'invalid profileId');
	await db.transaction(async (tx) => {
		await lockUserProfiles(tx, userId);
		const [target] = await tx
			.select({ profileId: userPreferences.profileId })
			.from(userPreferences)
			.where(and(eq(userPreferences.userId, userId), eq(userPreferences.profileId, profileId)))
			.limit(1);
		if (!target) error(404, 'profile not found');
		await activateInTx(tx, userId, profileId);
	});
}

/**
 * Serialize every per-user profile mutation by locking ALL of the user's
 * profile rows (FOR UPDATE) at the top of the transaction. Without this, two
 * concurrent activates of different profiles can each deactivate only the rows
 * that were active at THEIR statement snapshot, then both set their target
 * active — the partial unique index `user_preferences_one_active` aborts one
 * with a unique_violation (codex). It also makes the delete not-active guard
 * atomic against a concurrent activate of the same row. Mirrors the world_maps
 * `SELECT … FOR UPDATE` convention in world-map-v3.ts.
 */
async function lockUserProfiles(tx: Db, userId: string): Promise<void> {
	await tx.execute(sql`SELECT profile_id FROM user_preferences WHERE user_id = ${userId} FOR UPDATE`);
}

/** Deactivate-all → activate-target. Caller MUST have verified target exists
 *  and MUST hold the per-user profile lock (lockUserProfiles). */
async function activateInTx(tx: Db, userId: string, profileId: string): Promise<void> {
	await tx
		.update(userPreferences)
		.set({ isActive: 0 })
		.where(and(eq(userPreferences.userId, userId), eq(userPreferences.isActive, 1)));
	await tx
		.update(userPreferences)
		.set({ isActive: 1 })
		.where(and(eq(userPreferences.userId, userId), eq(userPreferences.profileId, profileId)));
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
	// Reject a too-new (or non-integer) schemaVersion BEFORE the appearance check's
	// early-return. Otherwise a client could persist e.g. { schemaVersion: 999 },
	// which makes every later hydrate throw PreferencesVersionError, zero out
	// serverVersion, and suppress all preference writes for that user until the row
	// is manually repaired (codex).
	if (data.schemaVersion !== undefined) {
		if (
			!Number.isInteger(data.schemaVersion) ||
			(data.schemaVersion as number) < 1 ||
			(data.schemaVersion as number) > PREFERENCES_CODE_MAX_VERSION
		) {
			error(400, `schemaVersion must be an integer between 1 and ${PREFERENCES_CODE_MAX_VERSION}`);
		}
	}
	// Phase 2 sections (Item 4 graph, Item 3 windows). Validated ABOVE the
	// appearance early-return so a blob with `graph`/`windows` but no `appearance`
	// is still checked (A3) — otherwise garbage toggles/geometry would persist.
	validateGraph(data.graph);
	validateWindows(data.windows);

	validateAppearance(data.appearance);
}

/**
 * Validate an `appearance` subtree (theme / accent / the three color maps).
 * Extracted from validateMergedData so Phase 3 appearance PRESETS reuse the
 * exact same rules — a preset's stored `appearance` must pass the same gate as
 * one merged into a profile. `undefined` is allowed (an absent appearance is
 * the built-in default); callers that REQUIRE it (presets) check presence
 * themselves before calling.
 */
export function validateAppearance(app: unknown): void {
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

/** Item 4 — graph toggle defaults: known boolean keys only. */
function validateGraph(value: unknown): void {
	if (value === undefined) return;
	if (!isPlainObject(value)) error(400, 'graph must be an object');
	const allowed = new Set(['hardFilter', 'showGhostTrails']);
	for (const [k, v] of Object.entries(value)) {
		if (!allowed.has(k)) error(400, `graph: unknown key '${k}'`);
		if (typeof v !== 'boolean') error(400, `graph.${k} must be a boolean`);
	}
}

// Window geometry bounds — generous but finite, to reject NaN/Infinity and a
// client (or attacker) persisting absurd values that would break layout math.
const WINDOW_MIN_DIM = 1;
const WINDOW_MAX_DIM = 10000;
const WINDOW_MAX_POS = 100000;

function isBoundedNumber(v: unknown, min: number, max: number): boolean {
	return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

/** Item 3 — window geometry defaults keyed by AppId. Closed validation: only
 *  `defaults` at the top level, only width/height/x/y per geometry (codex P3). */
function validateWindows(value: unknown): void {
	if (value === undefined) return;
	if (!isPlainObject(value)) error(400, 'windows must be an object');
	for (const k of Object.keys(value)) {
		if (k !== 'defaults') error(400, `windows: unknown key '${k}'`);
	}
	const defaults = value.defaults;
	if (defaults === undefined) return;
	if (!isPlainObject(defaults)) error(400, 'windows.defaults must be an object');
	const allowed = new Set<string>(APP_IDS);
	const geomKeys = new Set(['width', 'height', 'x', 'y']);
	for (const [appId, geom] of Object.entries(defaults)) {
		if (!allowed.has(appId)) error(400, `windows.defaults: unknown appId '${appId}'`);
		if (!isPlainObject(geom)) error(400, `windows.defaults.${appId} must be an object`);
		for (const k of Object.keys(geom)) {
			if (!geomKeys.has(k)) error(400, `windows.defaults.${appId}: unknown key '${k}'`);
		}
		if (!isBoundedNumber(geom.width, WINDOW_MIN_DIM, WINDOW_MAX_DIM)) {
			error(400, `windows.defaults.${appId}.width must be a number in [${WINDOW_MIN_DIM}, ${WINDOW_MAX_DIM}]`);
		}
		if (!isBoundedNumber(geom.height, WINDOW_MIN_DIM, WINDOW_MAX_DIM)) {
			error(400, `windows.defaults.${appId}.height must be a number in [${WINDOW_MIN_DIM}, ${WINDOW_MAX_DIM}]`);
		}
		if (geom.x !== undefined && !isBoundedNumber(geom.x, -WINDOW_MAX_POS, WINDOW_MAX_POS)) {
			error(400, `windows.defaults.${appId}.x must be a finite number`);
		}
		if (geom.y !== undefined && !isBoundedNumber(geom.y, -WINDOW_MAX_POS, WINDOW_MAX_POS)) {
			error(400, `windows.defaults.${appId}.y must be a finite number`);
		}
	}
}
