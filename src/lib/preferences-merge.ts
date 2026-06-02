/**
 * Pure merge primitives for the preferences blob — shared by the server PATCH
 * handler (src/lib/server/user-preferences.ts) and the client store
 * (src/lib/os/preferences-store.ts). One source of truth for merge semantics
 * so client-side optimistic merge and server-side authoritative merge cannot
 * diverge.
 *
 * No svelte, no DB, no SvelteKit imports — safe on both sides of the wire.
 *
 * Semantics:
 *  - deepMerge: plain-object recursive merge; arrays and primitives are
 *    replaced wholesale; prototype-pollution keys are skipped.
 *  - applyUnset: delete dotted paths from a (cloned) object — the
 *    representation of "reset this setting to default" (T2A), since deepMerge
 *    can only set, never delete.
 */

export const PROTO_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Plain-object deep merge. Arrays and primitives replace wholesale. Skips
 * prototype-pollution keys. Returns a defensive copy so callers can't mutate
 * `base`. Identical semantics to the original client-store deepMerge.
 */
export function deepMerge<T>(base: T, over: unknown): T {
	if (over === null || over === undefined) return base;
	const baseIsObj = isPlainObject(base);
	const overIsObj = isPlainObject(over);
	if (!baseIsObj && !overIsObj) {
		// Both non-object scalars — override wins.
		return over as T;
	}
	if (!baseIsObj || !overIsObj) {
		// Type mismatch (object vs scalar) — preserve base shape rather than
		// corrupt the caller's typed expectation.
		return base;
	}
	const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
	for (const key of Object.keys(over)) {
		if (PROTO_POLLUTION_KEYS.has(key)) continue;
		const baseVal = (base as Record<string, unknown>)[key];
		const overVal = (over as Record<string, unknown>)[key];
		result[key] = key in (base as object) ? deepMerge(baseVal, overVal) : overVal;
	}
	return result as T;
}

/**
 * Returns true if a dotted path is well-formed for unset: non-empty, ≤ 8
 * segments, every segment non-empty and not a prototype-pollution key.
 */
export function isSafeUnsetPath(path: unknown): path is string {
	if (typeof path !== 'string' || path.length === 0 || path.length > 256) return false;
	const segs = path.split('.');
	if (segs.length === 0 || segs.length > 8) return false;
	return segs.every((s) => s.length > 0 && !PROTO_POLLUTION_KEYS.has(s));
}

/**
 * Return a deep-ish clone of `obj` with each dotted path deleted. Used to
 * represent "reset to default" — the key is removed so the read-side cascade
 * falls back to the built-in default. Unknown / already-absent paths are
 * no-ops. Caller is responsible for validating paths with isSafeUnsetPath.
 */
export function applyUnset<T>(obj: T, paths: readonly string[]): T {
	if (!paths || paths.length === 0) return obj;
	// Structured clone via JSON round-trip — the blob is plain JSON by
	// construction (it came from jsonb / JSON.parse), so this is safe and keeps
	// us from mutating the caller's object.
	const clone = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
	for (const path of paths) {
		const segs = path.split('.');
		let cur: Record<string, unknown> = clone;
		let reachable = true;
		for (let i = 0; i < segs.length - 1; i++) {
			const next: unknown = cur[segs[i]];
			if (!isPlainObject(next)) {
				reachable = false;
				break;
			}
			cur = next;
		}
		if (reachable) delete cur[segs[segs.length - 1]];
	}
	return clone as T;
}
