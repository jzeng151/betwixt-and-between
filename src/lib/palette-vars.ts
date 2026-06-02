/**
 * Resolve user color preferences → CSS custom-property overrides, and apply
 * them (Settings customization Phase 1, T5). One mechanism feeds both the
 * client live-apply and the SSR-inline (T5b 3C).
 *
 * The cascade is "emit a :root override stylesheet": every consumer that reads
 * `var(--color-*)` (the graph via NODE_COLOR, the wiki/palette via
 * ENTITY_TYPE_COLOR_VAR, edges via REL_COLOR, role badges via --color-role-*)
 * picks up the override for free. Var NAMES are derived from the existing
 * ENTITY_TYPE_COLOR_VAR / REL_COLOR maps so there is no second source of truth.
 *
 * Note (rel-type co-variance): REL_COLOR maps several RelationshipTypes onto
 * ONE semantic --color-rel-* var (e.g. located_at + part_of → --color-rel-loc).
 * Overriding either recolors both. This matches the intentional var-sharing in
 * app.css; per-type rel vars would be a separate refactor.
 *
 * The world MAP is NOT covered (style-cascade.ts reads hardcoded hex, not these
 * vars) — Phase 2. Phase 1 recolors graph + wiki + palette + role badges.
 *
 * No svelte / DB imports — the pure fns are testable and SSR-safe; only
 * applyPaletteVars touches `document`.
 */

import type { Appearance } from './types/preferences.js';
import { ENTITY_TYPE_COLOR_VAR } from './entity-type-colors.js';
import { REL_COLOR } from './relationship-colors.js';
import { CHARACTER_ROLES } from './character-roles.js';

/** Extract `--x` from a `var(--x)` token; null if not that shape. */
function varName(token: string): string | null {
	const m = /^var\((--[a-z0-9-]+)\)$/.exec(token.trim());
	return m ? m[1] : null;
}

/**
 * The full set of CSS var names this module manages — used to RESET cleanly:
 * on each apply, a managed var that is no longer overridden is removed so it
 * falls back to the app.css default.
 */
export function managedPaletteVars(): string[] {
	const set = new Set<string>(['--color-accent']);
	for (const token of Object.values(ENTITY_TYPE_COLOR_VAR)) {
		const v = varName(token);
		if (v) set.add(v);
	}
	for (const token of Object.values(REL_COLOR)) {
		const v = varName(token);
		if (v) set.add(v);
	}
	for (const role of CHARACTER_ROLES) set.add(`--color-role-${role.toLowerCase()}`);
	return [...set];
}

/** Resolve an Appearance's overrides to a { cssVarName: hex } map. */
export function resolvePaletteVars(appearance: Appearance | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!appearance) return out;
	if (appearance.accentColor) out['--color-accent'] = appearance.accentColor;
	for (const [type, hex] of Object.entries(appearance.entityTypeColors ?? {})) {
		const token = ENTITY_TYPE_COLOR_VAR[type as keyof typeof ENTITY_TYPE_COLOR_VAR];
		const v = token ? varName(token) : null;
		if (v && hex) out[v] = hex;
	}
	for (const [type, hex] of Object.entries(appearance.relationshipTypeColors ?? {})) {
		const token = REL_COLOR[type as keyof typeof REL_COLOR];
		const v = token ? varName(token) : null;
		if (v && hex) out[v] = hex;
	}
	for (const [role, hex] of Object.entries(appearance.roleColors ?? {})) {
		if (hex) out[`--color-role-${role.toLowerCase()}`] = hex;
	}
	return out;
}

/** Build a `:root{…}` stylesheet body for SSR inlining (T5b 3C). Empty when no overrides. */
export function paletteVarsToCss(vars: Record<string, string>): string {
	const decls = Object.entries(vars)
		.map(([k, v]) => `${k}:${v}`)
		.join(';');
	return decls ? `:root{${decls}}` : '';
}

/**
 * Serialize an Appearance to the palette-cookie value (T5b): `{t, v}` where
 * t = theme short-code and v = resolved overrides. The server hook
 * (parsePaletteCookie) reads it to inline no-flash SSR vars. Client-only path
 * (needs the color maps); the parser is pure in palette-cookie.ts.
 */
export function serializePaletteCookie(
	appearance: Appearance | undefined,
	ownerUserId?: string | null
): string {
	const payload: { t: string; v: Record<string, string>; u?: string } = {
		t: appearance?.theme === 'light' ? 'l' : 'd',
		v: resolvePaletteVars(appearance)
	};
	// Tag the cookie with the signed-in user so the SSR hook can scope it to the
	// current account (codex P1, SSR half). Omitted when anonymous / unknown.
	if (ownerUserId) payload.u = ownerUserId;
	return JSON.stringify(payload);
}

/**
 * Apply overrides to documentElement, REMOVING managed vars that are no longer
 * overridden (so a reset falls back to the app.css default). Client-only;
 * no-op during SSR.
 */
export function applyPaletteVars(appearance: Appearance | undefined): void {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	const overrides = resolvePaletteVars(appearance);
	for (const name of managedPaletteVars()) {
		if (name in overrides) root.style.setProperty(name, overrides[name]);
		else root.style.removeProperty(name);
	}
}
