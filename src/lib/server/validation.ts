/**
 * Shared input validation helpers for server route handlers.
 *
 * Keep this file small and pure — no DB imports, no SvelteKit imports. The
 * helpers here run on every request hot-path; they should be cheap to call
 * and trivial to tree-shake.
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
