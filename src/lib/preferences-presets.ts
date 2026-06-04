/**
 * Pure helper for APPLYING an appearance preset (Settings customization Phase 3,
 * T10 / F1). No store / DOM / network — just the patch-shape computation, so it
 * unit-tests in isolation and is shared by the Settings UI.
 */

import type { Appearance } from './types/preferences.js';
import { isPlainObject } from './preferences-merge.js';

export interface PreferencePatch {
	set?: Record<string, unknown>;
	unset?: string[];
}

/**
 * Minimal dotted paths present in `active` but NOT in `preset`, pruned so an
 * entire missing sub-object yields ONE path (its root), not a path per leaf.
 * Pruning matters: unsetting every leaf of a sub-object would leave an empty
 * `{}` parent behind, so the result wouldn't equal the preset (which omits the
 * key entirely). When a key exists in both as objects, recurse; when it exists
 * in both as scalars, the `set` overwrites it, so nothing is unset.
 */
function pathsToUnset(
	active: Record<string, unknown>,
	preset: Record<string, unknown>,
	prefix: string
): string[] {
	const out: string[] = [];
	for (const [k, av] of Object.entries(active)) {
		const path = `${prefix}.${k}`;
		const pv = preset[k];
		if (pv === undefined) {
			out.push(path); // whole subtree absent in the preset → drop it
		} else if (isPlainObject(av) && isPlainObject(pv)) {
			out.push(...pathsToUnset(av, pv, path)); // both objects → recurse
		}
		// else: present in both as scalars → `set` overwrites, no unset needed.
	}
	return out;
}

/**
 * Build the PATCH that makes the active profile's appearance EXACTLY `preset`
 * (F1 — no stale color leak when the preset omits a key the profile had).
 *
 * The server (and the client's optimistic apply) run `set` THEN `unset`:
 *   set:   { appearance: preset }              → deep-merge adds/overwrites preset keys
 *   unset: active paths absent from the preset → drops the leftovers
 * so the result is exactly the preset. ONLY `appearance.*` is touched — graph /
 * windows / editor sections are left intact (the appearance-only contract, P4).
 * A naive `{ set: { appearance: preset } }` alone would leak the profile's old
 * color keys through deep-merge; the computed `unset` closes that.
 */
export function buildApplyPresetPatch(active: Appearance, preset: Appearance): PreferencePatch {
	const unset = pathsToUnset(
		active as unknown as Record<string, unknown>,
		preset as unknown as Record<string, unknown>,
		'appearance'
	);
	return { set: { appearance: preset }, unset };
}
