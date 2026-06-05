// Cinematic Spotlight (Slice 8) PR0 — pure RGB tint easing.
//
// The region "tide" must GLIDE between projected faction colors as the
// playhead steps scene-to-scene, not snap. The glide is written imperatively
// to a Pixi `Graphics.tint` each frame from inside the shared anim-controller
// ticker — NEVER through Svelte `$state`/`renderedState`, which would re-run
// the layer's geometry `$effect` at 60fps and re-enter the rebuild storm
// `anim-controller.ts` Fix-4 guards against.
//
// `Graphics.tint` is a flat 0xRRGGBB GPU multiply over a WHITE-filled polygon,
// so it never touches geometry. Easing happens per channel (the design's
// "componentwise easeToward" — same shape the camera uses for centerX/centerY/
// zoom). This module owns the pure colour math so it is unit-testable without a
// Pixi Application or a real ticker; window/Pixi-free (SSR-safe).

import { easeToward } from './ease.js';

export type Rgb = [number, number, number];

// Neutral gray fallback (matches NEUTRAL_REGION_COLOR / parseHex fallbacks in
// the layers) for malformed input — a bad colour glides to gray, never NaN.
const NEUTRAL: Rgb = [0x9c, 0xa3, 0xaf];

/**
 * Parse `#rgb` / `#rrggbb` / `#rrggbbaa` (alpha byte dropped — Pixi handles
 * alpha separately) into [r, g, b] channels in [0, 255]. Malformed input
 * returns the neutral gray fallback rather than throwing, mirroring the
 * lazy-GC posture the projection uses elsewhere.
 */
export function hexToRgb(input: string): Rgb {
	let s = input.trim().replace(/^#/, '');
	if (s.length === 3 || s.length === 4) {
		s = s
			.split('')
			.map((c) => c + c)
			.join('');
	}
	if (s.length === 8) s = s.slice(0, 6); // drop AA
	if (s.length !== 6) return [...NEUTRAL];
	const n = Number.parseInt(s, 16);
	if (!Number.isFinite(n) || Number.isNaN(n)) return [...NEUTRAL];
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Pack [r, g, b] channels into a 0xRRGGBB integer for `Graphics.tint`. */
export function rgbToTint([r, g, b]: Rgb): number {
	const ri = Math.round(Math.max(0, Math.min(255, r)));
	const gi = Math.round(Math.max(0, Math.min(255, g)));
	const bi = Math.round(Math.max(0, Math.min(255, b)));
	return (ri << 16) | (gi << 8) | bi;
}

/**
 * Ease each channel of `current` toward `target` over a `deltaMs` frame with
 * time constant `tauMs`. Frame-rate independent and never overshoots (inherits
 * easeToward's contract). Returns a fresh tuple; does not mutate `current`.
 */
export function easeRgb(current: Rgb, target: Rgb, deltaMs: number, tauMs: number): Rgb {
	return [
		easeToward(current[0], target[0], deltaMs, tauMs),
		easeToward(current[1], target[1], deltaMs, tauMs),
		easeToward(current[2], target[2], deltaMs, tauMs)
	];
}
