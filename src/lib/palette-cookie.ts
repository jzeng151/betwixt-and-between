/**
 * Palette cookie — the no-flash SSR channel (Settings customization T5b, 3C/6A).
 *
 * The client writes the resolved palette + theme to a cookie whenever
 * appearance changes; the server `handle` hook reads it and inlines a
 * `:root{…}` <style> + a `data-theme` attribute into the first HTML chunk, so a
 * logged-in user's custom colors are correct on the very first paint instead of
 * flashing the app.css defaults until hydration.
 *
 * This module is PURE (no svelte / DB / color-map imports) so the server hook
 * can import it without pulling client-feature code. The client-side
 * serializer (which needs the color maps) lives in palette-vars.ts.
 *
 * SECURITY: the cookie is user-controlled and its contents are inlined into a
 * <style>. parsePaletteCookie hard-sanitizes — only `--color-[a-z0-9-]` keys
 * and `#hex` values survive — so a tampered cookie can't inject arbitrary CSS.
 */

export const PALETTE_COOKIE = 'btw_palette';

export interface ParsedPaletteCookie {
	theme: 'light' | 'dark';
	vars: Record<string, string>;
	/** The user id the cookie was written for, or null if unscoped/anonymous. */
	owner: string | null;
}

export function accentForeground(hex: string): '#000000' | '#ffffff' {
	if (hex.length === 4 || hex.length === 5) {
		hex = `#${[...hex.slice(1)].map((value) => value + value).join('')}`;
	}
	const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((value) => {
		const channel = Number.parseInt(value, 16) / 255;
		return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	});
	const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
	return luminance > 0.179 ? '#000000' : '#ffffff';
}

const VAR_NAME_RE = /^--color-[a-z0-9-]+$/;
const HEX_RE = /^#[0-9a-f]{3,8}$/i;
// Owner ids are Better-Auth UUID-ish; bound length + charset so a tampered
// cookie can't smuggle anything large/odd through the `u` field.
const OWNER_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Parse + hard-sanitize the cookie. Returns null on absent/malformed input. */
export function parsePaletteCookie(raw: string | undefined | null): ParsedPaletteCookie | null {
	if (!raw) return null;
	let obj: unknown;
	try {
		obj = JSON.parse(decodeURIComponent(raw));
	} catch {
		return null;
	}
	if (typeof obj !== 'object' || obj === null) return null;
	const o = obj as { t?: unknown; v?: unknown; u?: unknown };
	const vars: Record<string, string> = {};
	if (o.v && typeof o.v === 'object') {
		for (const [k, val] of Object.entries(o.v as Record<string, unknown>)) {
			if (VAR_NAME_RE.test(k) && typeof val === 'string' && HEX_RE.test(val)) {
				vars[k] = val;
			}
		}
	}
	const owner = typeof o.u === 'string' && OWNER_RE.test(o.u) ? o.u : null;
	return { theme: o.t === 'l' ? 'light' : 'dark', vars, owner };
}

/** Build the `:root{…}` body (empty string when no vars). */
export function paletteCookieToCss(parsed: ParsedPaletteCookie | null): string {
	if (!parsed) return '';
	const vars = { ...parsed.vars };
	if (vars['--color-accent'] && !vars['--color-on-accent']) {
		vars['--color-on-accent'] = accentForeground(vars['--color-accent']);
	}
	const decls = Object.entries(vars)
		.map(([k, v]) => `${k}:${v}`)
		.join(';');
	return decls ? `:root{${decls}}` : '';
}
