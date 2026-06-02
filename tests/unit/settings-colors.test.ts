/**
 * Settings customization Phase 1 — T6 Settings color-panel model (pure).
 */

import { describe, it, expect } from 'vitest';
import {
	COLOR_SWATCHES,
	swatchesForGroup,
	swatchOverride,
	isModified,
	buildSetPatch,
	buildUnsetPatch,
	buildGroupResetPatch
} from '../../src/lib/settings-colors.js';
import type { Appearance } from '../../src/lib/types/preferences.js';

const base: Appearance = { theme: 'dark', accentColor: '#c8942a' };

describe('T6 settings-colors model', () => {
	it('builds swatches for all three groups', () => {
		expect(swatchesForGroup('entity').length).toBe(8); // 8 EntityTypes
		// 8 RelationshipTypes minus note_of (its var is the Note ENTITY var, so
		// customizing it would leak into the Entity group — excluded, codex).
		expect(swatchesForGroup('relationship').length).toBe(7);
		expect(swatchesForGroup('role').length).toBe(6); // 6 CHARACTER_ROLES
		expect(COLOR_SWATCHES.length).toBe(21);
	});

	it('excludes note_of from relationship swatches (no Entity-group color leak)', () => {
		expect(swatchesForGroup('relationship').find((s) => s.key === 'note_of')).toBeUndefined();
		// And nothing else maps to the Note entity var via the relationship group.
		expect(
			swatchesForGroup('relationship').some((s) => s.cssVar === 'var(--color-type-note)')
		).toBe(false);
	});

	it('humanizes relationship labels and keeps the default var token', () => {
		const allied = swatchesForGroup('relationship').find((s) => s.key === 'allied_with')!;
		expect(allied.label).toBe('Allied with');
		expect(allied.cssVar).toBe('var(--color-rel-ally)');
		const character = swatchesForGroup('entity').find((s) => s.key === 'Character')!;
		expect(character.cssVar).toBe('var(--color-type-character)');
	});

	it('reads overrides per group and reports modified', () => {
		const app: Appearance = {
			...base,
			entityTypeColors: { Character: '#ff0000' },
			roleColors: { Protagonist: '#00ff00' }
		};
		const ch = swatchesForGroup('entity').find((s) => s.key === 'Character')!;
		const loc = swatchesForGroup('entity').find((s) => s.key === 'Location')!;
		const prot = swatchesForGroup('role').find((s) => s.key === 'Protagonist')!;
		expect(swatchOverride(app, ch)).toBe('#ff0000');
		expect(isModified(app, ch)).toBe(true);
		expect(isModified(app, loc)).toBe(false);
		expect(swatchOverride(app, prot)).toBe('#00ff00');
	});

	it('buildSetPatch nests under the right group map', () => {
		const ch = swatchesForGroup('entity').find((s) => s.key === 'Character')!;
		expect(buildSetPatch(ch, '#abcdef')).toEqual({
			set: { appearance: { entityTypeColors: { Character: '#abcdef' } } }
		});
		const rivals = swatchesForGroup('relationship').find((s) => s.key === 'rivals')!;
		expect(buildSetPatch(rivals, '#111111')).toEqual({
			set: { appearance: { relationshipTypeColors: { rivals: '#111111' } } }
		});
	});

	it('buildUnsetPatch targets the dotted override path', () => {
		const prot = swatchesForGroup('role').find((s) => s.key === 'Protagonist')!;
		expect(buildUnsetPatch(prot)).toEqual({ unset: ['appearance.roleColors.Protagonist'] });
	});

	it('buildGroupResetPatch unsets only the modified swatches in a group', () => {
		const app: Appearance = {
			...base,
			entityTypeColors: { Character: '#ff0000', Event: '#00ff00' }
		};
		const patch = buildGroupResetPatch(app, 'entity');
		expect(patch.unset.sort()).toEqual([
			'appearance.entityTypeColors.Character',
			'appearance.entityTypeColors.Event'
		]);
		// A group with no overrides resets nothing.
		expect(buildGroupResetPatch(app, 'role').unset).toEqual([]);
	});
});
