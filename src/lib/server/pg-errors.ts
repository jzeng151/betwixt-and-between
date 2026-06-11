// Shared PG error classification (2026-06 audit). Drizzle + the postgres-js /
// Neon drivers wrap the original Postgres error inconsistently — the SQLSTATE
// can sit on the error itself or on `.cause` — so check both levels, same as
// the inline classifiers in the relationships and maps routes.

export function isUniqueViolation(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	if ((err as { code?: string }).code === '23505') return true;
	const cause = (err as { cause?: unknown }).cause;
	return !!cause && typeof cause === 'object' && (cause as { code?: string }).code === '23505';
}

/**
 * True if the error carries a Postgres SQLSTATE (on the error itself or on
 * `.cause`) — i.e. it came from the driver, not from app-level validation
 * (which throws plain `Error`s whose messages are safe, user-facing strings).
 *
 * Route bounds-resolution catches use this to opaque raw driver errors
 * (malformed-UUID cast 22P02, CHECK 23514, FK 23503, …) as a 500 — closing the
 * raw-message leak — while still surfacing the helpers' own validation messages
 * as 400s. (2026-06 review follow-up; complements the entities routes, whose
 * validation throws HttpErrors so they can blanket-opaque the rest.)
 */
export function isPgError(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const code = (err as { code?: unknown }).code;
	if (typeof code === 'string' && code.length > 0) return true;
	const cause = (err as { cause?: unknown }).cause;
	if (!cause || typeof cause !== 'object') return false;
	const causeCode = (cause as { code?: unknown }).code;
	return typeof causeCode === 'string' && causeCode.length > 0;
}
