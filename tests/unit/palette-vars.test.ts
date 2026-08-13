/**
 * Settings customization Phase 1 — T5 palette resolution + 4A merge.
 *
 * resolvePaletteVars maps Appearance overrides → CSS var overrides (var names
 * derived from the existing color maps), paletteVarsToCss builds the SSR
 * stylesheet, and R1 pins the 4A merge: NODE_COLOR is now the SAME object as
 * ENTITY_TYPE_COLOR_VAR and graph node colors are unchanged.
 */

import { describe, it, expect } from 'vitest';
import {
	resolvePaletteVars,
	paletteVarsToCss,
	managedPaletteVars,
	accentForeground
} from '../../src/lib/palette-vars.js';
import { ENTITY_TYPE_COLOR_VAR } from '../../src/lib/entity-type-colors.js';
import { NODE_COLOR } from '../../src/lib/relationship-colors.js';
import type { Appearance } from '../../src/lib/types/preferences.js';

describe('T5 resolvePaletteVars', () => {
	it('returns {} for no overrides', () => {
		expect(resolvePaletteVars(undefined)).toEqual({});
		expect(resolvePaletteVars({ theme: 'dark', accentColor: '' } as Appearance)).toEqual({});
	});

	it('maps accent + entity-type + role overrides to their 1:1 vars', () => {
		const app: Appearance = {
			theme: 'dark',
			accentColor: '#111111',
			entityTypeColors: { Character: '#c8942a', Location: '#00ff00' },
			roleColors: { Protagonist: '#abcdef' }
		};
		expect(resolvePaletteVars(app)).toEqual({
			'--color-accent': '#111111',
			'--color-on-accent': '#ffffff',
			'--color-type-character': '#c8942a',
			'--color-type-location': '#00ff00',
			'--color-role-protagonist': '#abcdef'
		});
	});

	it('maps relationship-type overrides onto the shared semantic var (documented co-variance)', () => {
		// located_at + part_of both resolve to --color-rel-loc in REL_COLOR.
		const app: Appearance = {
			theme: 'dark',
			accentColor: '',
			relationshipTypeColors: { rivals: '#ff0000', located_at: '#0000ff' }
		};
		const vars = resolvePaletteVars(app);
		expect(vars['--color-rel-rival']).toBe('#ff0000');
		expect(vars['--color-rel-loc']).toBe('#0000ff');
	});

	it('paletteVarsToCss builds a :root block (empty string when no vars)', () => {
		expect(paletteVarsToCss({})).toBe('');
		expect(paletteVarsToCss({ '--color-accent': '#111111', '--color-type-character': '#222222' })).toBe(
			':root{--color-accent:#111111;--color-type-character:#222222}'
		);
	});

	it('managedPaletteVars covers accent, all type vars, and all role vars', () => {
		const managed = new Set(managedPaletteVars());
		expect(managed.has('--color-accent')).toBe(true);
		expect(managed.has('--color-on-accent')).toBe(true);
		expect(managed.has('--color-type-character')).toBe(true);
		expect(managed.has('--color-role-protagonist')).toBe(true);
		expect(managed.has('--color-rel-rival')).toBe(true);
	});

	it('chooses a contrasting foreground for light and dark accents', () => {
		expect(accentForeground('#111111')).toBe('#ffffff');
		expect(accentForeground('#f2b84b')).toBe('#000000');
		expect(accentForeground('#fff')).toBe('#000000');
		expect(accentForeground('#000')).toBe('#ffffff');
	});
});

describe('T5 4A merge regression (R1)', () => {
	it('NODE_COLOR IS ENTITY_TYPE_COLOR_VAR (one source of truth)', () => {
		expect(NODE_COLOR).toBe(ENTITY_TYPE_COLOR_VAR);
	});

	it('all 8 entity types still resolve to their --color-type-* token (colors unchanged)', () => {
		expect(NODE_COLOR).toEqual({
			Character: 'var(--color-type-character)',
			Location: 'var(--color-type-location)',
			Event: 'var(--color-type-event)',
			Act: 'var(--color-type-act)',
			Scene: 'var(--color-type-scene)',
			Note: 'var(--color-type-note)',
			Artifact: 'var(--color-type-artifact)',
			Item: 'var(--color-type-item)'
		});
	});
});
