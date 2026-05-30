// Slice 4 PR-C — single source of truth for the style override bounds.
//
// `data.style` (on entities AND placements) is the closed-enum
// { color?, icon?, scale?, opacity? } shape. The server validator
// (src/lib/server/style-validation.ts) rejects out-of-bounds writes at the
// boundary; the client StyleEditor mirrors these same bounds for inline
// feedback. Keeping the numbers, the hex regex, and the key whitelist here —
// a declaration-only, client-safe module — means the two layers can't drift.
//
// Declaration-only (consts + a regex literal), so it is safe to import from
// both server code and client components per the CLAUDE.md server-only rule.

// CSS hex: 3/4/6/8 digits (5 and 7 are not valid). Canonical copy; the server
// validator imports this rather than keeping its own.
export const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export const STYLE_BOUNDS = {
	scale: { min: 0.1, max: 10 },
	opacity: { min: 0, max: 1 },
	/** Closed enum of allowed `data.style` keys. */
	keys: ['color', 'icon', 'scale', 'opacity'] as const,
	/** Total serialized jsonb size cap (defends against giant blobs). */
	maxBytes: 4 * 1024
} as const;

export type StyleKey = (typeof STYLE_BOUNDS.keys)[number];
