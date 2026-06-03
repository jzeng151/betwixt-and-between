/**
 * Server chokepoint for `appearance_presets` (Settings customization Phase 3,
 * T10). Mirrors user-preferences.ts: every read/write of a user's presets goes
 * through here so the cross-user scope (rows keyed by session-derived userId)
 * and the appearance validation live in one place.
 *
 * Presets are appearance-ONLY and immutable except delete — there is no rename
 * or edit path, so no version counter and no bump_updated_at trigger (the table
 * has no updated_at). Apply is NOT here: applying a preset is a normal prefs
 * PATCH the client builds (buildApplyPresetPatch), so the optimistic-merge +
 * optimistic-concurrency path is reused unchanged.
 */

import { and, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { appearancePresets } from './db/schema.js';
import type { Db } from './intervals.js';
import { isUuid } from './validation.js';
import { isPlainObject } from '../preferences-merge.js';
import { validateAppearance, validateDisplayName, MAX_BLOB_BYTES } from './user-preferences.js';
import { BUILTIN_APPEARANCE_PRESETS, type PresetSummary } from '../appearance-presets.js';
import type { Appearance } from '../types/preferences.js';

export interface PresetList {
	/** Read-only built-ins (constants, no row). */
	builtins: PresetSummary[];
	/** The user's saved presets, oldest first. */
	user: PresetSummary[];
}

/** Built-ins + the user's saved preset rows. Built-ins are constants, not rows. */
export async function listPresets(db: Db, userId: string): Promise<PresetList> {
	const rows = await db
		.select({
			presetId: appearancePresets.presetId,
			name: appearancePresets.name,
			appearance: appearancePresets.appearance
		})
		.from(appearancePresets)
		.where(eq(appearancePresets.userId, userId))
		.orderBy(appearancePresets.createdAt);
	const user = rows.map((r) => ({
		presetId: r.presetId,
		name: r.name,
		appearance: r.appearance as unknown as Appearance,
		builtin: false
	}));
	return { builtins: [...BUILTIN_APPEARANCE_PRESETS], user };
}

/**
 * Save an appearance blob as a named preset. Validates the name (400) and the
 * appearance with the SAME validators a prefs PATCH uses (reuse, not re-impl) —
 * a preset can't store a color the render path would choke on. Duplicate names
 * are allowed (Open Q3: personal tool, low stakes).
 */
export async function createPreset(
	db: Db,
	userId: string,
	name: string,
	appearance: unknown
): Promise<PresetSummary> {
	const presetName = validateDisplayName(name);
	if (!isPlainObject(appearance)) error(400, 'appearance must be an object');
	validateAppearance(appearance);
	// validateAppearance only checks the known keys; unknown top-level keys pass
	// through and would be stored verbatim. Bound the serialized size (same cap as
	// a full prefs blob) so a client can't bloat its preset rows — which are
	// returned on every Settings preset-list load (codex).
	const size = JSON.stringify(appearance).length;
	if (size > MAX_BLOB_BYTES) error(400, `preset appearance too large (${size} > ${MAX_BLOB_BYTES} bytes)`);
	const [row] = await db
		.insert(appearancePresets)
		.values({ userId, name: presetName, appearance: appearance as Record<string, unknown> })
		.returning();
	return {
		presetId: row.presetId,
		name: row.name,
		appearance: row.appearance as unknown as Appearance,
		builtin: false
	};
}

/**
 * Delete a user preset. Built-in ids are `builtin:*` sentinels, not uuids, so a
 * delete of one fails the uuid guard with 400 — built-ins are not deletable.
 */
export async function deletePreset(db: Db, userId: string, presetId: string): Promise<void> {
	if (!isUuid(presetId)) error(400, 'invalid presetId');
	const deleted = await db
		.delete(appearancePresets)
		.where(and(eq(appearancePresets.userId, userId), eq(appearancePresets.presetId, presetId)))
		.returning();
	if (deleted.length === 0) error(404, 'preset not found');
}
