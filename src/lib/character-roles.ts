/**
 * Character roles — the values offered in the CharacterHeader role dropdown,
 * stored on `entities.data.role`. The
 * client editor (CharacterHeader) and server-side preference validation import
 * one source of truth instead of duplicating the literal list. Matches the
 * EntityType / RelationshipType pattern in schema.ts.
 *
 * The empty-string "no role" option in the dropdown is intentionally NOT a
 * member here — it represents "unset" (no data.role), not a role value.
 */
export const CHARACTER_ROLES = [
	'Protagonist',
	'Antagonist',
	'Ally',
	'Rival',
	'Mentor',
	'Supporting'
] as const;
export type CharacterRole = (typeof CHARACTER_ROLES)[number];

export const ROLE_OPTIONS = [
	{ value: '', color: 'var(--color-text-muted)' },
	...CHARACTER_ROLES.map((value) => ({ value, color: `var(--color-role-${value.toLowerCase()})` }))
];

export function roleColor(role: string): string {
	return ROLE_OPTIONS.find((option) => option.value.toLowerCase() === role.toLowerCase())?.color
		?? 'var(--color-text-muted)';
}

export function initials(name: string): string {
	return name.split(' ').map((word) => word[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';
}
