/**
 * Appearance presets — shared declaration-only surface (Settings customization
 * Phase 3, T10). Imported by BOTH the client (Settings UI) and the server
 * (validation + the presets API), so it must carry no runtime side effects and
 * no server-only imports (mirrors app-ids.ts / entity-type-colors.ts).
 *
 * A preset is an appearance-ONLY blob that is *applied* (patched into the active
 * profile's appearance.*), never activated like a profile. Built-ins ship as the
 * constants below (read-only, no DB row); user-saved presets are rows in
 * `appearance_presets`.
 */

import type { Appearance } from './types/preferences.js';

export interface PresetSummary {
	/** Built-ins use a `builtin:` sentinel id; user presets use a uuid. */
	presetId: string;
	name: string;
	appearance: Appearance;
	/** Read-only constant (true) vs a user-saved row (false). */
	builtin: boolean;
}

/** Built-in preset ids carry this prefix so they can never be a real uuid row. */
export const BUILTIN_PRESET_ID_PREFIX = 'builtin:';

export function isBuiltinPresetId(id: string): boolean {
	return id.startsWith(BUILTIN_PRESET_ID_PREFIX);
}

/**
 * Built-in appearance presets. Each is a full, valid `Appearance` (theme +
 * accent + per-entity-type colors) so applying one fully replaces the active
 * profile's appearance.* (the apply path unsets old keys the preset omits).
 */
export const BUILTIN_APPEARANCE_PRESETS: readonly PresetSummary[] = [
	{
		presetId: 'builtin:high-contrast',
		name: 'High Contrast',
		builtin: true,
		appearance: {
			theme: 'dark',
			accentColor: '#ffd400',
			entityTypeColors: {
				Character: '#ffffff',
				Location: '#00ff7f',
				Event: '#ff4dff',
				Act: '#b388ff',
				Scene: '#40c4ff',
				Note: '#cfcfcf',
				Artifact: '#ff7a00',
				Item: '#ffd400'
			}
		}
	},
	{
		presetId: 'builtin:sepia',
		name: 'Sepia',
		builtin: true,
		appearance: {
			theme: 'light',
			accentColor: '#8a5a2b',
			entityTypeColors: {
				Character: '#7c4a1e',
				Location: '#5c6b3a',
				Event: '#9b4a2f',
				Act: '#6b4e7a',
				Scene: '#3a6b6b',
				Note: '#8a7d6b',
				Artifact: '#a8642a',
				Item: '#9a7b2a'
			}
		}
	}
];
