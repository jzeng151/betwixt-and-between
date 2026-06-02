/**
 * Pure model for the Settings color panel (T6). Builds the swatch list from the
 * existing color maps (one source of truth), reads/writes overrides on an
 * Appearance, and constructs the {set}/{unset} patches the sync controller
 * consumes. Kept DOM-free so the logic is unit-tested; Settings.svelte stays
 * thin (rendering + native color input + applyPreferencePatch wiring).
 */

import { ENTITY_TYPE_COLOR_VAR } from './entity-type-colors.js';
import { REL_COLOR } from './relationship-colors.js';
import { CHARACTER_ROLES } from './character-roles.js';
import type { Appearance } from './types/preferences.js';

export type ColorGroup = 'entity' | 'relationship' | 'role';

export interface ColorSwatch {
	group: ColorGroup;
	/** EntityType / RelationshipType / CharacterRole key. */
	key: string;
	/** Human label for the row. */
	label: string;
	/** `var(--color-…)` token — the chip's default fill when not overridden. */
	cssVar: string;
}

const GROUP_MAP_KEY: Record<ColorGroup, keyof Appearance> = {
	entity: 'entityTypeColors',
	relationship: 'relationshipTypeColors',
	role: 'roleColors'
};

/** "allied_with" → "Allied with". */
function humanize(key: string): string {
	const s = key.replace(/_/g, ' ');
	return s.charAt(0).toUpperCase() + s.slice(1);
}

export const COLOR_SWATCHES: ColorSwatch[] = [
	...Object.keys(ENTITY_TYPE_COLOR_VAR).map(
		(key): ColorSwatch => ({
			group: 'entity',
			key,
			label: key,
			cssVar: ENTITY_TYPE_COLOR_VAR[key as keyof typeof ENTITY_TYPE_COLOR_VAR]
		})
	),
	...Object.keys(REL_COLOR).map(
		(key): ColorSwatch => ({
			group: 'relationship',
			key,
			label: humanize(key),
			cssVar: REL_COLOR[key as keyof typeof REL_COLOR]
		})
	),
	...CHARACTER_ROLES.map(
		(role): ColorSwatch => ({
			group: 'role',
			key: role,
			label: role,
			cssVar: `var(--color-role-${role.toLowerCase()})`
		})
	)
];

export function swatchesForGroup(group: ColorGroup): ColorSwatch[] {
	return COLOR_SWATCHES.filter((s) => s.group === group);
}

/** The override hex for a swatch, or undefined if not customized. */
export function swatchOverride(appearance: Appearance | undefined, sw: ColorSwatch): string | undefined {
	const map = appearance?.[GROUP_MAP_KEY[sw.group]] as Record<string, string> | undefined;
	return map?.[sw.key];
}

export function isModified(appearance: Appearance | undefined, sw: ColorSwatch): boolean {
	return swatchOverride(appearance, sw) !== undefined;
}

/** Patch to set one swatch's color. */
export function buildSetPatch(sw: ColorSwatch, hex: string): { set: Record<string, unknown> } {
	return { set: { appearance: { [GROUP_MAP_KEY[sw.group]]: { [sw.key]: hex } } } };
}

/** Patch to reset one swatch to its default (delete the override). */
export function buildUnsetPatch(sw: ColorSwatch): { unset: string[] } {
	return { unset: [`appearance.${GROUP_MAP_KEY[sw.group]}.${sw.key}`] };
}

/** Patch to reset every overridden swatch in a group. */
export function buildGroupResetPatch(
	appearance: Appearance | undefined,
	group: ColorGroup
): { unset: string[] } {
	const unset = swatchesForGroup(group)
		.filter((s) => isModified(appearance, s))
		.map((s) => `appearance.${GROUP_MAP_KEY[group]}.${s.key}`);
	return { unset };
}
