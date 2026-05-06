/**
 * Shared input validation helpers for server route handlers.
 * No DB imports, no SvelteKit imports.
 */

/**
 * UUID v1-v5 (any version) regex. `entities.id` is a real `uuid` column in pg;
 * a non-uuid string at insert/select time would FK-fail with a confusing
 * "invalid input syntax for type uuid" error from pg. Pre-validate so callers
 * get a clean 400 instead of a noisy 500.
 *
 * Lowercase or uppercase both accepted (RFC 4122 says uuids are
 * case-insensitive on the wire).
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
	return typeof v === 'string' && UUID_RE.test(v);
}

/**
 * Coerce a JSON-ish "pinned" input to the integer 0/1 invariant the schema
 * requires. Accepts both booleans (the natural JSON shape from a typical
 * client) and numbers (the literal storage shape). Anything else returns 0,
 * matching the schema default.
 *
 * Rationale (Greptile P2 fix on PR #10): a client that sends `pinned: true`
 * was silently mapping to 0 because `typeof true !== 'number'` short-circuited
 * the previous branch. Two reasonable resolutions:
 *   (a) accept booleans (this fn) — friendliest API, matches what every
 *       JSON client naturally sends
 *   (b) reject non-integer pinned with 400 — stricter
 * (a) wins for a single-user writer's app where the boolean is the natural
 * shape; the integer column stays for sqlite-portability the original spec
 * locked in.
 */
export function coercePinned(v: unknown): 0 | 1 {
	if (typeof v === 'boolean') return v ? 1 : 0;
	if (typeof v === 'number') return v ? 1 : 0;
	return 0;
}

/**
 * Check whether a polygon (array of [lat, lng] pairs) is self-intersecting.
 * Uses O(n^2) edge-crossing test — fine for user-drawn polygons with < 100 vertices.
 * Returns `true` if any two non-adjacent edges cross.
 */
export function isSelfIntersecting(polygon: number[][]): boolean {
	const n = polygon.length;
	if (n < 3) return true; // degenerate

	for (let i = 0; i < n; i++) {
		const a1 = polygon[i];
		const a2 = polygon[(i + 1) % n];
		for (let j = i + 2; j < n; j++) {
			// skip adjacent edges (share a vertex) and the wrap-around pair
			if (i === 0 && j === n - 1) continue;
			const b1 = polygon[j];
			const b2 = polygon[(j + 1) % n];
			if (segmentsCross(a1, a2, b1, b2)) return true;
		}
	}
	return false;
}

function segmentsCross(a: number[], b: number[], c: number[], d: number[]): boolean {
	const d1 = cross(c, d, a);
	const d2 = cross(c, d, b);
	const d3 = cross(a, b, c);
	const d4 = cross(a, b, d);
	if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
		((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
	return false;
}

function cross(o: number[], a: number[], b: number[]): number {
	return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}
