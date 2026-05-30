// Slice 3 outside-voice T24 (B9c) — server-side style jsonb whitelist.
//
// `data.style` on entities AND `data.style` on placements share one
// shape: { color?, icon?, scale?, opacity? }. Anything else is a bug
// or a malicious payload — reject at the boundary with 400.
//
// Why server-side: the client cascade resolver (style-cascade.ts) is
// trust-the-input; bad data persisted on disk would silently corrupt
// every reader. CLAUDE.md "validate at system boundaries" applies.
//
// Constraints (codex outside voice review):
//   - color: CSS hex (#abc / #abcd / #aabbcc / #aabbccdd)
//   - icon: string URL or explicit null
//   - scale: 0.1 ≤ n ≤ 10
//   - opacity: 0 ≤ n ≤ 1
//   - Total jsonb size: ≤ 4KB (defends against giant blobs)
//   - Unknown keys: rejected (closed enum of fields)
//
// The validator throws SvelteKit error(400, ...). Callers wrap their
// PATCH/POST handlers and let it propagate.

import { error } from '@sveltejs/kit';
// Slice 4 PR-C — bounds live in a shared declaration-only module so the client
// StyleEditor and this server validator can't drift. (world-map-v3.ts keeps its
// own HEX_COLOR_RE for region colors; out of scope here.)
import { HEX_COLOR_RE, STYLE_BOUNDS } from '$lib/style-bounds.js';

const ALLOWED_KEYS = new Set<string>(STYLE_BOUNDS.keys);
const MAX_STYLE_BYTES = STYLE_BOUNDS.maxBytes;

/**
 * Validate a single style override object. Throws 400 on any
 * violation; returns void on success.
 *
 * `path` is the JSON pointer-ish label used in error messages
 * (e.g. "entity.data.style" or "placement.data.style"). Helps the
 * client identify which payload field went bad.
 */
export function validateStyleOverride(raw: unknown, path: string): void {
	if (raw === undefined || raw === null) return; // absent = nothing to check
	if (typeof raw !== 'object' || Array.isArray(raw)) {
		error(400, `${path} must be an object`);
	}

	// Size cap. Serialize once and measure; same JSON the DB will store.
	const serialized = JSON.stringify(raw);
	if (serialized.length > MAX_STYLE_BYTES) {
		error(400, `${path} exceeds ${MAX_STYLE_BYTES} bytes`);
	}

	const obj = raw as Record<string, unknown>;
	for (const key of Object.keys(obj)) {
		if (!ALLOWED_KEYS.has(key)) {
			error(
				400,
				`${path} contains unknown key '${key}'; allowed: ${[...ALLOWED_KEYS].join(', ')}`
			);
		}
	}

	if ('color' in obj && obj.color !== undefined) {
		if (typeof obj.color !== 'string' || !HEX_COLOR_RE.test(obj.color)) {
			error(400, `${path}.color must be a CSS hex string like '#aabbcc'`);
		}
	}

	if ('icon' in obj && obj.icon !== undefined) {
		const v = obj.icon;
		if (v !== null && typeof v !== 'string') {
			error(400, `${path}.icon must be a string URL or null`);
		}
	}

	if ('scale' in obj && obj.scale !== undefined) {
		const v = obj.scale;
		const { min, max } = STYLE_BOUNDS.scale;
		if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
			error(400, `${path}.scale must be a number in [${min}, ${max}]`);
		}
	}

	if ('opacity' in obj && obj.opacity !== undefined) {
		const v = obj.opacity;
		const { min, max } = STYLE_BOUNDS.opacity;
		if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
			error(400, `${path}.opacity must be a number in [${min}, ${max}]`);
		}
	}
}

/**
 * Convenience: validate a `data` object's nested `style` field if
 * present. Used at PATCH /api/entities (entity.data.style) and at
 * POST/PATCH /api/map-placements (placement.data.style).
 */
export function validateStyleInData(data: unknown, path: string): void {
	if (!data || typeof data !== 'object' || Array.isArray(data)) return;
	const style = (data as Record<string, unknown>).style;
	if (style !== undefined) {
		validateStyleOverride(style, `${path}.style`);
	}
}
