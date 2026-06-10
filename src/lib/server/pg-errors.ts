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
