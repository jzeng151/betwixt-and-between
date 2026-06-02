/**
 * Character roles — the values offered in the CharacterHeader role dropdown,
 * stored on `entities.data.role`. Declaration-only (`as const` + type) so the
 * client editor (CharacterHeader) and server-side preference validation import
 * ONE source of truth instead of duplicating the literal list. Matches the
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
