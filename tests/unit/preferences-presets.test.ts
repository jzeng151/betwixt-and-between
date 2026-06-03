/**
 * Settings customization Phase 3 — apply-preset patch builder (T10 / F1).
 *
 * The load-bearing property: applying a preset leaves the active profile's
 * appearance EXACTLY equal to the preset — no stale color key from the old
 * appearance leaks through deep-merge. We assert that by replaying the patch the
 * same way the server does: applyUnset(deepMerge(base, set), unset).
 */

import { describe, it, expect } from 'vitest';
import { buildApplyPresetPatch } from '../../src/lib/preferences-presets.js';
import { deepMerge, applyUnset } from '../../src/lib/preferences-merge.js';
import type { Appearance } from '../../src/lib/types/preferences.js';

/** Replay a {set,unset} patch exactly as patchPreferences does (set then unset). */
function applyPatch(
	base: Record<string, unknown>,
	patch: { set?: Record<string, unknown>; unset?: string[] }
): Record<string, unknown> {
	return applyUnset(deepMerge(base, patch.set ?? {}), patch.unset ?? []);
}

describe('buildApplyPresetPatch', () => {
	it('makes appearance exactly the preset (drops keys the preset omits — F1)', () => {
		const active: Appearance = {
			theme: 'dark',
			accentColor: '#111111',
			entityTypeColors: { Character: '#aaaaaa', Location: '#bbbbbb' },
			roleColors: { Protagonist: '#cccccc' }
		};
		const preset: Appearance = {
			theme: 'light',
			accentColor: '#222222',
			entityTypeColors: { Location: '#999999', Event: '#777777' }
		};

		const patch = buildApplyPresetPatch(active, preset);
		const result = applyPatch({ appearance: active, graph: { hardFilter: true } }, patch).appearance;

		// Exactly the preset — Character (active-only) and roleColors are gone,
		// Location is the preset's value, Event (preset-only) is present.
		expect(result).toEqual(preset);
	});

	it('only touches appearance.* — graph/windows/editor sections survive', () => {
		const active: Appearance = {
			theme: 'dark',
			accentColor: '#111111',
			entityTypeColors: { Character: '#aaaaaa' }
		};
		const preset: Appearance = { theme: 'light', accentColor: '#222222' };

		const base = {
			appearance: active,
			graph: { hardFilter: true, showGhostTrails: true },
			windows: { defaults: { settings: { width: 400, height: 300 } } },
			editor: { linkPreviewEnabled: false },
			schemaVersion: 5
		};
		const patch = buildApplyPresetPatch(active, preset);
		const result = applyPatch(base as unknown as Record<string, unknown>, patch);

		expect(result.appearance).toEqual(preset);
		expect(result.graph).toEqual({ hardFilter: true, showGhostTrails: true });
		expect(result.windows).toEqual({ defaults: { settings: { width: 400, height: 300 } } });
		expect(result.editor).toEqual({ linkPreviewEnabled: false });
		expect(result.schemaVersion).toBe(5);
	});

	it('applying the same preset twice is idempotent', () => {
		const preset: Appearance = {
			theme: 'dark',
			accentColor: '#abcdef',
			entityTypeColors: { Character: '#123456' }
		};
		const first = applyPatch({ appearance: preset }, buildApplyPresetPatch(preset, preset))
			.appearance as Appearance;
		expect(first).toEqual(preset);
	});
});
