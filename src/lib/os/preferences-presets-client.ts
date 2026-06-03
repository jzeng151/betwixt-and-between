/**
 * Client-side fetch helpers + apply wiring for appearance presets (Settings
 * customization Phase 3, T10 — D2 UI).
 *
 * Apply is NOT a server call: it's an ordinary optimistic prefs PATCH built by
 * buildApplyPresetPatch and pushed through applyPreferencePatch, so it reuses
 * the whole optimistic-merge + debounced-sync path. list/create/delete are
 * plain requests.
 */

import type { Appearance } from '../types/preferences.js';
import type { PresetSummary } from '../appearance-presets.js';
import { ensureOk } from './api-error.js';
import { buildApplyPresetPatch } from '../preferences-presets.js';
import { applyPreferencePatch } from './preferences-sync.js';

export async function fetchPresets(): Promise<{ builtins: PresetSummary[]; user: PresetSummary[] }> {
	const res = await ensureOk(await fetch('/api/preferences/presets'), 'list presets failed');
	return (await res.json()) as { builtins: PresetSummary[]; user: PresetSummary[] };
}

export async function createPresetRequest(
	name: string,
	appearance: Appearance
): Promise<PresetSummary> {
	const res = await ensureOk(
		await fetch('/api/preferences/presets', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, appearance })
		}),
		'save preset failed'
	);
	return (await res.json()) as PresetSummary;
}

export async function deletePresetRequest(presetId: string): Promise<void> {
	await ensureOk(
		await fetch(`/api/preferences/presets/${encodeURIComponent(presetId)}`, { method: 'DELETE' }),
		'delete preset failed'
	);
}

/**
 * Apply a preset to the active profile: replace appearance.* with the preset
 * (optimistic + synced). Graph/window/editor prefs are untouched.
 */
export function applyPreset(active: Appearance, preset: Appearance): void {
	applyPreferencePatch(buildApplyPresetPatch(active, preset));
}
