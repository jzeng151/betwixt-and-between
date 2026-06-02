/**
 * Settings customization Phase 1 — T5b palette cookie (no-flash SSR channel).
 * The parse path is the security boundary: a user-controlled cookie is inlined
 * into a <style>, so only --color-* keys + #hex values may survive.
 */

import { describe, it, expect } from 'vitest';
import { parsePaletteCookie, paletteCookieToCss } from '../../src/lib/palette-cookie.js';
import { serializePaletteCookie } from '../../src/lib/palette-vars.js';
import type { Appearance } from '../../src/lib/types/preferences.js';

describe('T5b parsePaletteCookie', () => {
	it('returns null for absent/empty/malformed input', () => {
		expect(parsePaletteCookie(undefined)).toBeNull();
		expect(parsePaletteCookie('')).toBeNull();
		expect(parsePaletteCookie('not json')).toBeNull();
		expect(parsePaletteCookie(encodeURIComponent('42'))).toBeNull();
	});

	it('parses theme + valid vars', () => {
		const raw = encodeURIComponent(JSON.stringify({ t: 'l', v: { '--color-type-character': '#ff0000' } }));
		expect(parsePaletteCookie(raw)).toEqual({
			theme: 'light',
			vars: { '--color-type-character': '#ff0000' }
		});
	});

	it('defaults theme to dark when not "l"', () => {
		expect(parsePaletteCookie(encodeURIComponent(JSON.stringify({ t: 'd', v: {} })))?.theme).toBe('dark');
		expect(parsePaletteCookie(encodeURIComponent(JSON.stringify({ v: {} })))?.theme).toBe('dark');
	});

	it('SANITIZES: drops non --color-* keys, non-hex values, and injection attempts', () => {
		const raw = encodeURIComponent(
			JSON.stringify({
				t: 'd',
				v: {
					'--color-type-character': '#abcdef', // ok
					'background': 'red', // bad key
					'--color-evil': 'red; } body { display:none', // CSS injection via value
					'--color-type-event': 'javascript:x', // non-hex value
					'--color-type-act}{x:y': '#000000' // bad key chars
				}
			})
		);
		expect(parsePaletteCookie(raw)).toEqual({
			theme: 'dark',
			vars: { '--color-type-character': '#abcdef' }
		});
	});
});

describe('T5b paletteCookieToCss', () => {
	it('builds :root block, empty when no vars or null', () => {
		expect(paletteCookieToCss(null)).toBe('');
		expect(paletteCookieToCss({ theme: 'dark', vars: {} })).toBe('');
		expect(paletteCookieToCss({ theme: 'dark', vars: { '--color-accent': '#111111' } })).toBe(
			':root{--color-accent:#111111}'
		);
	});
});

describe('T5b serialize → parse round-trip', () => {
	it('survives the round-trip with overrides intact', () => {
		const app: Appearance = {
			theme: 'light',
			accentColor: '#123456',
			entityTypeColors: { Character: '#abcdef' }
		};
		const cookie = encodeURIComponent(serializePaletteCookie(app));
		const parsed = parsePaletteCookie(cookie)!;
		expect(parsed.theme).toBe('light');
		expect(parsed.vars['--color-accent']).toBe('#123456');
		expect(parsed.vars['--color-type-character']).toBe('#abcdef');
	});
});
